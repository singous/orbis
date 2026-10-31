import { cn } from "../cn";

export function resolveClassName<State>(defaults: string, className?: string | ((state: State) => string | undefined)) {
  return (state: State) => cn(defaults, typeof className === "function" ? className(state) : className);
}
