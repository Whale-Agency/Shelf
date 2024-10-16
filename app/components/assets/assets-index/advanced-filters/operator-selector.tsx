import React, { useEffect, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { Button } from "~/components/shared/button";
import { tw } from "~/utils/tw";
import type { Filter, FilterDefinition, FilterOperator } from "./types";

function FilterOperatorDisplay({
  symbol,
  text,
}: {
  symbol: string;
  text: string;
}) {
  return (
    <div className="flex items-center gap-2 text-[14px] ">
      <span className="text-gray-500">{symbol}</span>
      <span className=" whitespace-nowrap">{text}</span>
    </div>
  );
}

/** Maps the FilterOperator to a user friendly name */
const operatorsMap: Record<FilterOperator, string[]> = {
  is: ["=", "is"],
  isNot: ["≠", "Is not"],
  contains: ["∋", "Contains"],
  before: ["<", "Before"],
  after: [">", "After"],
  between: ["<>", "Between"],
  gt: [">", "Greater than"],
  lt: ["<", "Lower than"],
  gte: [">=", "Greater or equal"],
  lte: ["<=", "Lower or equal"],
  in: ["∈", "Contains"],
  containsAll: ["⊇", "Contains all"],
  containsAny: ["⊃", "Contains any"],
};

// Define the allowed operators for each field type
export const operatorsPerType: FilterDefinition = {
  string: ["is", "isNot", "contains"],
  text: ["contains"],
  boolean: ["is"],
  date: ["is", "isNot", "before", "after", "between"],
  number: ["is", "isNot", "gt", "lt", "gte", "lte", "between"],
  enum: ["is", "isNot"],
  array: ["contains", "containsAll", "containsAny"],
};

export function OperatorSelector({
  filter,
  setFilter,
}: {
  filter: Filter;
  setFilter: (filter: Filter["operator"]) => void;
}) {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  const [operator, setOperator] = useState<FilterOperator>();
  useEffect(() => {
    setOperator(filter.operator);
  }, [filter.operator]);

  /** Get the correct operators, based on the field type */
  const operators = operatorsPerType[filter.type];

  return operator ? (
    <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          title={operatorsMap[operator][1]}
          className="w-[50px]"
        >
          {operatorsMap[operator][0]}
        </Button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          align="start"
          className={tw(
            "z-[999999]  mt-2  rounded-md border border-gray-200 bg-white"
          )}
        >
          {operators.map((operator, index) => {
            const k = operator as FilterOperator;
            const v = operatorsMap[k];
            return (
              <div
                key={k + index}
                className="px-4 py-2 text-[14px] font-medium text-gray-600 hover:cursor-pointer hover:bg-gray-50"
                onClick={() => {
                  setFilter(k as FilterOperator);
                  setIsPopoverOpen(false);
                }}
              >
                <FilterOperatorDisplay symbol={v[0]} text={v[1]} />
              </div>
            );
          })}
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  ) : null;
}
