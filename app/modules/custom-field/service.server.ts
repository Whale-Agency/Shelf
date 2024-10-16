import type { CustomField, Organization, Prisma, User } from "@prisma/client";
import { db } from "~/database/db.server";
import { getDefinitionFromCsvHeader } from "~/utils/custom-fields";
import type { ErrorLabel } from "~/utils/error";
import {
  ShelfError,
  isLikeShelfError,
  maybeUniqueConstraintViolation,
} from "~/utils/error";
import type { CustomFieldDraftPayload } from "./types";
import type { CreateAssetFromContentImportPayload } from "../asset/types";
import type { Column } from "../asset-index-settings/helpers";
import { updateAssetIndexSettingsAfterCfUpdate } from "../asset-index-settings/service.server";

const label: ErrorLabel = "Custom fields";

export async function createCustomField({
  name,
  helpText,
  type,
  required,
  organizationId,
  active,
  userId,
  options = [],
  categories = [],
}: CustomFieldDraftPayload) {
  try {
    const [customField, assetIndexSettingsEntries] = await Promise.all([
      db.customField.create({
        data: {
          name,
          helpText,
          type,
          required,
          active,
          options,
          organization: {
            connect: {
              id: organizationId,
            },
          },
          createdBy: {
            connect: {
              id: userId,
            },
          },
          categories: {
            connect: categories.map((category) => ({ id: category })),
          },
        },
      }),
      db.assetIndexSettings.findMany({
        where: { organizationId },
      }),
    ]);

    /** We need to add it to the advanced index settings for each entry belonging to this organization */
    if (customField.active) {
      await Promise.all(
        assetIndexSettingsEntries.map(async (entry) => {
          const columns = Array.from(entry.columns as Prisma.JsonArray);
          const prevHighestPosition = (columns as Column[]).reduce(
            (acc, col) => (col.position > acc ? col.position : acc),
            0
          );

          columns.push({
            name: `cf_${customField.name}`,
            visible: true,
            position: prevHighestPosition + 1,
          });

          await db.assetIndexSettings.update({
            where: { id: entry.id, organizationId },
            data: { columns },
          });
        })
      );
    }

    return customField;
  } catch (cause) {
    throw maybeUniqueConstraintViolation(cause, "Custom field", {
      additionalData: { userId, organizationId },
    });
  }
}

export async function getFilteredAndPaginatedCustomFields(params: {
  organizationId: Organization["id"];
  /** Page number. Starts at 1 */
  page?: number;
  /** Items to be loaded per page */
  perPage?: number;
  search?: string | null;
}) {
  const { organizationId, page = 1, perPage = 8, search } = params;

  try {
    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 ? perPage : 8; // min 1 and max 25 per page

    /** Default value of where. Takes the items belonging to current user */
    let where: Prisma.CustomFieldWhereInput = { organizationId };

    /** If the search string exists, add it to the where object */
    if (search) {
      where.name = {
        contains: search,
        mode: "insensitive",
      };
    }

    const [customFields, totalCustomFields] = await Promise.all([
      /** Get the items */
      db.customField.findMany({
        skip,
        take,
        where,
        orderBy: [{ active: "desc" }, { updatedAt: "desc" }],
        include: { categories: true },
      }),

      /** Count them */
      db.customField.count({ where }),
    ]);

    return { customFields, totalCustomFields };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while fetching the custom fields",
      additionalData: { ...params },
      label,
    });
  }
}

export async function getCustomField({
  organizationId,
  id,
}: Pick<CustomField, "id"> & {
  organizationId: Organization["id"];
}) {
  try {
    return await db.customField.findFirstOrThrow({
      where: { id, organizationId },
      include: { categories: { select: { id: true } } },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Custom field not found",
      message:
        "The custom field you are trying to access does not exist or you do not have permission to access it.",
      additionalData: { id, organizationId },
      label,
    });
  }
}

export async function updateCustomField(payload: {
  id: CustomField["id"];
  name?: CustomField["name"];
  helpText?: CustomField["helpText"];
  type?: CustomField["type"];
  required?: CustomField["required"];
  active?: CustomField["active"];
  options?: CustomField["options"];
  categories?: string[];
}) {
  const { id, name, helpText, required, active, options, categories } = payload;

  try {
    //dont ever update type
    //updating type would require changing all custom field values to that type
    //which might fail when changing to incompatible type hence need a careful definition
    const data = {
      name,
      helpText,
      required,
      active,
      options,
      categories: {
        set: categories?.map((category) => ({ id: category })),
      },
    } satisfies Prisma.CustomFieldUpdateInput;

    /** Get the custom field. We need it in order to be able to update the asset index settings */
    const customField = (await db.customField.findFirst({
      where: { id },
    })) as CustomField;

    const updatedField = await db.customField.update({
      where: { id },
      data: data,
    });

    /** Updates the Asset */
    await updateAssetIndexSettingsAfterCfUpdate({
      oldField: customField,
      newField: updatedField,
    });

    return updatedField;
  } catch (cause) {
    throw maybeUniqueConstraintViolation(cause, "Custom field", {
      additionalData: {
        id,
      },
    });
  }
}

export async function upsertCustomField(
  definitions: CustomFieldDraftPayload[]
): Promise<Record<string, CustomField>> {
  try {
    const customFields: Record<string, CustomField> = {};

    for (const def of definitions) {
      let existingCustomField = await db.customField.findFirst({
        where: {
          name: {
            equals: def.name,
            mode: "insensitive",
          },
          organizationId: def.organizationId,
        },
      });

      if (!existingCustomField) {
        const newCustomField = await createCustomField(def);
        customFields[def.name] = newCustomField;
      } else {
        if (existingCustomField.type !== def.type) {
          throw new ShelfError({
            cause: null,
            message: `Duplicate custom field name with different type. '${def.name}' already exist with different type '${existingCustomField.type}'`,
            additionalData: {
              validationErrors: {
                name: {
                  message: `${def.name} already exist with different type ${existingCustomField.type}`,
                },
              },
            },
            label,
          });
        }
        if (existingCustomField.type === "OPTION") {
          const newOptions = def.options?.filter(
            (op) => !existingCustomField?.options?.includes(op)
          );
          if (newOptions?.length) {
            //create non existing options
            const options = (existingCustomField?.options || []).concat(
              Array.from(new Set(newOptions))
            );
            const updatedCustomField = await updateCustomField({
              id: existingCustomField.id,
              options,
            });
            existingCustomField = updatedCustomField;
          }
        }
        customFields[def.name] = existingCustomField;
      }
    }

    return customFields;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Failed to update or create custom fields. Please try again or contact support.",
      additionalData: { definitions },
      label,
    });
  }
}

export async function createCustomFieldsIfNotExists({
  data,
  userId,
  organizationId,
}: {
  data: CreateAssetFromContentImportPayload[];
  userId: User["id"];
  organizationId: Organization["id"];
}): Promise<Record<string, CustomField>> {
  try {
    //{CF header:[all options in csv combined]}
    const optionMap: Record<string, string[]> = {};
    //{CF header: definition to create}
    const fieldToDefDraftMap: Record<string, CustomFieldDraftPayload> = {};

    for (let item of data) {
      for (let k of Object.keys(item)) {
        if (k.startsWith("cf:")) {
          const def = getDefinitionFromCsvHeader(k);
          if (!fieldToDefDraftMap[k]) {
            fieldToDefDraftMap[k] = { ...def, userId, organizationId };
          }
          /** Only add the options if they have a value */
          if (def.type === "OPTION" && item[k] !== "") {
            optionMap[k] = (optionMap[k] || []).concat([item[k]]);
          }
        }
      }
    }

    for (const [customFieldDefStr, def] of Object.entries(fieldToDefDraftMap)) {
      if (def.type === "OPTION" && optionMap[customFieldDefStr]?.length) {
        const uniqueSet = new Set(optionMap[customFieldDefStr]);
        def.options = Array.from(uniqueSet);
      }
    }
    return await upsertCustomField(Object.values(fieldToDefDraftMap));
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while creating custom fields. Seems like some of the custom field data in your import file is invalid. Please check and try again.",
      additionalData: { userId, organizationId },
      label,
      /** No need to capture those. They are mostly related to malformed CSV data */
      shouldBeCaptured: false,
    });
  }
}

export async function getActiveCustomFields({
  organizationId,
  category,
}: {
  organizationId: string;
  category?: string | null;
}) {
  try {
    return await db.customField.findMany({
      where: {
        organizationId,
        active: { equals: true },
        ...(typeof category === "string"
          ? {
              OR: [
                { categories: { none: {} } }, // Custom fields with no category
                { categories: { some: { id: category } } },
              ],
            }
          : { categories: { none: {} } }),
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Failed to get active custom fields. Please try again or contact support.",
      additionalData: { organizationId },
      label,
    });
  }
}

export async function countActiveCustomFields({
  organizationId,
}: {
  organizationId: string;
}) {
  try {
    return await db.customField.count({
      where: { organizationId, active: true },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while fetching active custom fields. Please try again or contact support.",
      additionalData: { organizationId },
      label,
    });
  }
}

export async function bulkActivateOrDeactivateCustomFields({
  customFields,
  organizationId,
  userId,
  active,
}: {
  customFields: CustomField[];
  organizationId: CustomField["organizationId"];
  userId: CustomField["userId"];
  active: boolean;
}) {
  try {
    const customFieldsIds = customFields.map((field) => field.id);

    const updatedFields = await db.customField.updateMany({
      where: { id: { in: customFieldsIds } },
      data: { active },
    });

    /** Get the asset index settings for the organization */
    const settings = await db.assetIndexSettings.findMany({
      where: { organizationId },
    });

    /** Update the asset index settings for each entry */
    const updates = settings.map((entry) => {
      const columns = Array.from(entry.columns as Prisma.JsonArray) as Column[];

      customFields.forEach((field) => {
        const oldField = field;
        const newField = { ...field, active };
        const cfIndex = columns.findIndex(
          (col) => col?.name === `cf_${oldField.name}`
        );
        if (newField.active) {
          /** Field is missing so we add it */
          if (cfIndex === -1) {
            const prevHighestPosition = columns.reduce(
              (acc, col) => (col.position > acc ? col.position : acc),
              0
            );
            columns.push({
              name: `cf_${newField.name}`,
              visible: true,
              position: prevHighestPosition + 1,
            });
          } else {
            columns[cfIndex] = {
              name: `cf_${newField.name}`,
              visible: columns[cfIndex].visible,
              position: columns[cfIndex].position,
            };
          }
        } else {
          columns.splice(cfIndex, 1);
        }
      });

      return db.assetIndexSettings.update({
        where: { id: entry.id, organizationId },
        data: { columns },
      });
    });

    await Promise.all(updates.filter(Boolean));

    return updatedFields;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while bulk activating custom fields.",
      additionalData: { customFields, organizationId, userId },
      label,
    });
  }
}
