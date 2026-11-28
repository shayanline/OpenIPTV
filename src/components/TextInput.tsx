import { forwardRef, useId, type InputHTMLAttributes } from "react";
import { KEY } from "../hooks/useRemote";

export type TextInputExit = "start" | "end" | "up" | "down";

export function textInputExit(
  input: HTMLInputElement,
  code: number,
  rtl = document.documentElement.dir === "rtl",
): TextInputExit | null {
  if (code === KEY.UP) return "up";
  if (code === KEY.DOWN) return "down";
  const start = rtl ? KEY.RIGHT : KEY.LEFT;
  const end = rtl ? KEY.LEFT : KEY.RIGHT;
  if (code === start && input.selectionStart === 0 && input.selectionEnd === 0) return "start";
  if (
    code === end &&
    input.selectionStart === input.value.length &&
    input.selectionEnd === input.value.length
  )
    return "end";
  return null;
}

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  problem?: string;
  variant?: "default" | "compact" | "embedded";
  onExitStart?: () => void;
  onExitEnd?: () => void;
  onExitUp?: () => void;
  onExitDown?: () => void;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  {
    className = "",
    invalid = false,
    problem,
    variant = "default",
    onExitStart,
    onExitEnd,
    onExitUp,
    onExitDown,
    onKeyDown,
    ...props
  },
  ref,
) {
  const generatedId = useId();
  const problemId = `${props.id ?? `input-${generatedId}`}-problem`;
  const description =
    [props["aria-describedby"], problem ? problemId : undefined].filter(Boolean).join(" ") ||
    undefined;
  return (
    <>
      <input
        {...props}
        ref={ref}
        aria-invalid={invalid || !!problem || undefined}
        aria-describedby={description}
        className={`text-input ${variant === "default" ? "" : variant} ${className}`.trim()}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented) return;
          const exit = textInputExit(event.currentTarget, event.keyCode);
          const leave =
            exit === "start"
              ? onExitStart
              : exit === "end"
                ? onExitEnd
                : exit === "up"
                  ? onExitUp
                  : exit === "down"
                    ? onExitDown
                    : undefined;
          if (leave) {
            event.preventDefault();
            event.stopPropagation();
            leave();
          } else if (!exit && (event.keyCode === KEY.LEFT || event.keyCode === KEY.RIGHT)) {
            event.stopPropagation();
          }
        }}
      />
      {problem && (
        <p className="field-problem" id={problemId} role="alert">
          {problem}
        </p>
      )}
    </>
  );
});
