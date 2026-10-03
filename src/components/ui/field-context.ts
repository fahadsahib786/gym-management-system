import { createContext, useContext } from "react";

/**
 * The id a surrounding <Field> gives its control, so the label stays linked even through wrappers such as
 * react-hook-form's <Controller> (clickable labels, screen readers, tests).
 */
export const FieldIdContext = createContext<string | undefined>(undefined);

/** An explicit `id` wins; otherwise the id of the enclosing <Field>. */
export function useFieldId(id?: string): string | undefined {
  const fromField = useContext(FieldIdContext);
  return id ?? fromField;
}
