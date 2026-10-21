import {
  AlignLeft,
  Calendar,
  CalendarClock,
  CalendarPlus,
  ChartNoAxesColumn,
  CircleCheck,
  Hash,
  Image,
  Link,
  ListChecks,
  Mail,
  Paperclip,
  Phone,
  SquareCheck,
  Star,
  User,
  UserPen,
  UserPlus,
} from "lucide-react";
import type { Kind } from "./model";
const icons = {
  text: AlignLeft,
  number: Hash,
  select: CircleCheck,
  multi_select: ListChecks,
  datetime: Calendar,
  person: User,
  image: Image,
  attachment: Paperclip,
  checkbox: SquareCheck,
  url: Link,
  email: Mail,
  phone: Phone,
  rating: Star,
  progress: ChartNoAxesColumn,
  created_by: UserPlus,
  created_at: CalendarPlus,
  updated_by: UserPen,
  updated_at: CalendarClock,
};
export function FieldIcon({ kind, size = 14 }: { kind: Kind; size?: number }) {
  const Icon = icons[kind];
  return <Icon size={size} aria-hidden="true" />;
}
