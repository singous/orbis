import { AutoSkeleton } from "@orbis/ui/skeleton";
import "./bones/registry";

export default function GeneratedSkeleton({ name }: { name: string }) {
  return <AutoSkeleton name={name} loading>{null}</AutoSkeleton>;
}
