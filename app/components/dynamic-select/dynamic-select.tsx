import React, { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { useModelFilters } from "~/hooks";
import type { ModelFilterItem, ModelFilterProps } from "~/hooks";
import { tw } from "~/utils";
import Input from "../forms/input";
import { CheckIcon } from "../icons";
import { Button } from "../shared";
import type { Icon } from "../shared/icons-map";
import When from "../when/when";

type Props = ModelFilterProps & {
  className?: string;
  style?: React.CSSProperties;
  fieldName?: string;
  label?: React.ReactNode;
  searchIcon?: Icon;
  showSearch?: boolean;
  defaultValue?: string;
  renderItem?: (item: ModelFilterItem) => React.ReactNode;
  extraContent?: React.ReactNode;
  disabled?: boolean;
  placeholder?: string;
};

export default function DynamicSelect({
  className,
  style,
  fieldName,
  label,
  searchIcon = "search",
  showSearch = true,
  defaultValue,
  model,
  countKey,
  initialDataKey,
  renderItem,
  extraContent,
  disabled,
  placeholder = `Select ${model.name}`,
}: Props) {
  const [selectedValue, setSelectedValue] = useState<string | undefined>(
    defaultValue
  );

  const {
    searchQuery,
    handleSearchQueryChange,
    items,
    totalItems,
    clearFilters,
    selectedItems,
    resetModelFiltersFetcher,
    handleSelectItemChange,
  } = useModelFilters({
    model,
    countKey,
    initialDataKey,
    selectionMode: "none",
  });

  return (
    <div className="relative w-full">
      <input
        type="hidden"
        value={selectedValue}
        name={fieldName ?? model.name}
      />

      <Popover>
        <PopoverTrigger disabled={disabled} asChild>
          <div className="rounded-md border border-gray-300 px-4 py-2 disabled:opacity-50">
            {items.find((i) => i.id === selectedValue)?.name ?? placeholder}
          </div>
        </PopoverTrigger>

        <PopoverContent
          className={tw(
            "z-[100] max-h-[410px] w-[290px] overflow-y-auto rounded-md border border-gray-300 bg-white md:w-80",
            className
          )}
          style={style}
          align="start"
          sideOffset={5}
        >
          <div className="flex items-center justify-between p-3">
            <div className="text-xs text-gray-500">{label}</div>
            <When truthy={selectedItems?.length > 0 && showSearch}>
              <Button
                as="button"
                variant="link"
                className="whitespace-nowrap text-xs font-normal text-gray-500 hover:text-gray-600"
                onClick={() => {
                  setSelectedValue(undefined);
                  clearFilters();
                }}
              >
                Clear filter
              </Button>
            </When>
          </div>
          <When truthy={showSearch}>
            <div className="filters-form relative px-3">
              <Input
                type="text"
                label={`Search ${label}`}
                placeholder={`Search ${label}`}
                hideLabel
                className="mb-2 text-gray-500"
                icon={searchIcon}
                value={searchQuery}
                onChange={handleSearchQueryChange}
                autoFocus
              />
              <When truthy={Boolean(searchQuery)}>
                <Button
                  icon="x"
                  variant="tertiary"
                  disabled={Boolean(searchQuery)}
                  onClick={() => {
                    setSelectedValue(undefined);
                    resetModelFiltersFetcher();
                  }}
                  className="z-100 pointer-events-auto absolute right-6 top-0 h-full border-0 p-0 text-center text-gray-400 hover:text-gray-900"
                />
              </When>
            </div>
          </When>

          <div className="divide-y">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex cursor-pointer select-none items-center justify-between gap-4 px-6 py-4 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-gray-100 focus:bg-gray-100"
                onClick={() => {
                  setSelectedValue(item.id);
                  handleSelectItemChange(item.id);
                }}
              >
                <div>
                  {typeof renderItem === "function" ? (
                    renderItem({ ...item, metadata: item })
                  ) : (
                    <div className="flex items-center truncate text-sm font-medium">
                      {item.name}
                    </div>
                  )}
                </div>

                <When truthy={item.id === selectedValue}>
                  <CheckIcon className="size-3.5 text-primary" />
                </When>
              </div>
            ))}
          </div>

          <When truthy={totalItems > 4}>
            <div className="p-3 text-gray-500">
              Showing {items.length} out of {totalItems}, type to search for
              more
            </div>
          </When>

          <When truthy={typeof extraContent !== "undefined"}>
            <div className="border-t px-3 pb-3">{extraContent}</div>
          </When>
        </PopoverContent>
      </Popover>
    </div>
  );
}
