import {
  AlertTriangle as LucideAlertTriangle,
  Archive as LucideArchive,
  ArchiveRestore as LucideArchiveRestore,
  ArrowDown as LucideArrowDown,
  ArrowLeft as LucideArrowLeft,
  ArrowRight as LucideArrowRight,
  ArrowUp as LucideArrowUp,
  ArrowUpRight as LucideArrowUpRight,
  BookOpen as LucideBookOpen,
  Boxes as LucideBoxes,
  BrainCircuit as LucideBrainCircuit,
  BriefcaseBusiness as LucideBriefcaseBusiness,
  Check as LucideCheck,
  ChevronDown as LucideChevronDown,
  ChevronRight as LucideChevronRight,
  ChevronsLeft as LucideChevronsLeft,
  ChevronsRight as LucideChevronsRight,
  CircleCheck as LucideCircleCheck,
  Clock3 as LucideClock3,
  Cloud as LucideCloud,
  Code2 as LucideCode2,
  Coffee as LucideCoffee,
  Copy as LucideCopy,
  Crown as LucideCrown,
  Download as LucideDownload,
  ExternalLink as LucideExternalLink,
  Eye as LucideEye,
  EyeOff as LucideEyeOff,
  FilePlus2 as LucideFilePlus2,
  FileText as LucideFileText,
  FileWarning as LucideFileWarning,
  FlaskConical as LucideFlaskConical,
  Folder as LucideFolder,
  FolderKanban as LucideFolderKanban,
  FolderPlus as LucideFolderPlus,
  Globe as LucideGlobe,
  Globe2 as LucideGlobe2,
  GraduationCap as LucideGraduationCap,
  GripVertical as LucideGripVertical,
  Heart as LucideHeart,
  History as LucideHistory,
  Home as LucideHome,
  ImagePlus as LucideImagePlus,
  Import as LucideImport,
  Info as LucideInfo,
  Layers as LucideLayers,
  LibraryBig as LucideLibraryBig,
  Lightbulb as LucideLightbulb,
  Link2 as LucideLink2,
  List as LucideList,
  ListOrdered as LucideListOrdered,
  LoaderCircle as LucideLoaderCircle,
  LogOut as LucideLogOut,
  Mail as LucideMail,
  Menu as LucideMenu,
  MessageSquare as LucideMessageSquare,
  Monitor as LucideMonitor,
  Moon as LucideMoon,
  MoreHorizontal as LucideMoreHorizontal,
  Music as LucideMusic,
  Notebook as LucideNotebook,
  OctagonAlert as LucideOctagonAlert,
  Orbit as LucideOrbit,
  Palette as LucidePalette,
  PanelRightClose as LucidePanelRightClose,
  PanelRightOpen as LucidePanelRightOpen,
  Pencil as LucidePencil,
  PencilLine as LucidePencilLine,
  Pin as LucidePin,
  Plus as LucidePlus,
  RefreshCcw as LucideRefreshCcw,
  RefreshCw as LucideRefreshCw,
  Rocket as LucideRocket,
  RotateCcw as LucideRotateCcw,
  RotateCw as LucideRotateCw,
  Save as LucideSave,
  Search as LucideSearch,
  Settings as LucideSettings,
  Settings2 as LucideSettings2,
  Shield as LucideShield,
  Sparkles as LucideSparkles,
  Sun as LucideSun,
  Target as LucideTarget,
  Trash2 as LucideTrash2,
  TriangleAlert as LucideTriangleAlert,
  UserPlus as LucideUserPlus,
  UserRound as LucideUserRound,
  Users as LucideUsers,
  WifiOff as LucideWifiOff,
  X as LucideX,
  type LucideIcon, type LucideProps,
} from "lucide-react";
import { forwardRef } from "react";
import { navigationIconPaths } from "./navigation-icon-paths";

export type { LucideIcon, LucideProps } from "lucide-react";
export type IconTone = "orange" | "cyan" | "blue" | "indigo" | "teal" | "violet" | "rose" | "amber" | "slate" | "success" | "danger" | "warning";
const DEFAULT_ICON_SIZE = 16;
const DEFAULT_STROKE_WIDTH = 1.8;

function appIcon(Icon: LucideIcon, name: string, tone?: IconTone): LucideIcon {
  const ThemedIcon = forwardRef<SVGSVGElement, LucideProps>(({ className, size = DEFAULT_ICON_SIZE, strokeWidth = DEFAULT_STROKE_WIDTH, ...props }, ref) =>
    <Icon {...props} ref={ref} size={size} strokeWidth={strokeWidth} className={["orbis-icon", className].filter(Boolean).join(" ")} data-orbis-icon={name} data-icon-tone={tone} aria-hidden={props["aria-hidden"] ?? ((props["aria-label"] || props["aria-labelledby"] || props.role === "img") ? undefined : true)} focusable={props.focusable ?? false} >
      {navigationIconPaths[name] ? <path className="orbis-icon-solid" d={navigationIconPaths[name]} fill="currentColor" fillRule="evenodd" stroke="none" /> : null}
      {props.children}
    </Icon>);
  ThemedIcon.displayName = `Orbis${name}`;
  return ThemedIcon;
}

export const AlertTriangle = /* @__PURE__ */ appIcon(LucideAlertTriangle, "AlertTriangle", "warning");
export const Archive = /* @__PURE__ */ appIcon(LucideArchive, "Archive", "amber");
export const ArchiveRestore = /* @__PURE__ */ appIcon(LucideArchiveRestore, "ArchiveRestore");
export const ArrowDown = /* @__PURE__ */ appIcon(LucideArrowDown, "ArrowDown");
export const ArrowLeft = /* @__PURE__ */ appIcon(LucideArrowLeft, "ArrowLeft");
export const ArrowRight = /* @__PURE__ */ appIcon(LucideArrowRight, "ArrowRight");
export const ArrowUp = /* @__PURE__ */ appIcon(LucideArrowUp, "ArrowUp");
export const ArrowUpRight = /* @__PURE__ */ appIcon(LucideArrowUpRight, "ArrowUpRight");
export const BookOpen = /* @__PURE__ */ appIcon(LucideBookOpen, "BookOpen", "blue");
export const Boxes = /* @__PURE__ */ appIcon(LucideBoxes, "Boxes");
export const BrainCircuit = /* @__PURE__ */ appIcon(LucideBrainCircuit, "BrainCircuit", "rose");
export const BriefcaseBusiness = /* @__PURE__ */ appIcon(LucideBriefcaseBusiness, "BriefcaseBusiness", "orange");
export const Check = /* @__PURE__ */ appIcon(LucideCheck, "Check", "success");
export const ChevronDown = /* @__PURE__ */ appIcon(LucideChevronDown, "ChevronDown");
export const ChevronRight = /* @__PURE__ */ appIcon(LucideChevronRight, "ChevronRight");
export const ChevronsLeft = /* @__PURE__ */ appIcon(LucideChevronsLeft, "ChevronsLeft");
export const ChevronsRight = /* @__PURE__ */ appIcon(LucideChevronsRight, "ChevronsRight");
export const CircleCheck = /* @__PURE__ */ appIcon(LucideCircleCheck, "CircleCheck", "success");
export const Clock3 = /* @__PURE__ */ appIcon(LucideClock3, "Clock3", "amber");
export const Cloud = /* @__PURE__ */ appIcon(LucideCloud, "Cloud", "teal");
export const Code2 = /* @__PURE__ */ appIcon(LucideCode2, "Code2", "indigo");
export const Coffee = /* @__PURE__ */ appIcon(LucideCoffee, "Coffee", "amber");
export const Copy = /* @__PURE__ */ appIcon(LucideCopy, "Copy");
export const Crown = /* @__PURE__ */ appIcon(LucideCrown, "Crown", "amber");
export const Download = /* @__PURE__ */ appIcon(LucideDownload, "Download");
export const ExternalLink = /* @__PURE__ */ appIcon(LucideExternalLink, "ExternalLink");
export const Eye = /* @__PURE__ */ appIcon(LucideEye, "Eye");
export const EyeOff = /* @__PURE__ */ appIcon(LucideEyeOff, "EyeOff");
export const FilePlus2 = /* @__PURE__ */ appIcon(LucideFilePlus2, "FilePlus2", "blue");
export const FileText = /* @__PURE__ */ appIcon(LucideFileText, "FileText", "blue");
export const FileWarning = /* @__PURE__ */ appIcon(LucideFileWarning, "FileWarning", "warning");
export const FlaskConical = /* @__PURE__ */ appIcon(LucideFlaskConical, "FlaskConical", "teal");
export const Folder = /* @__PURE__ */ appIcon(LucideFolder, "Folder", "amber");
export const FolderKanban = /* @__PURE__ */ appIcon(LucideFolderKanban, "FolderKanban");
export const FolderPlus = /* @__PURE__ */ appIcon(LucideFolderPlus, "FolderPlus");
export const Globe = /* @__PURE__ */ appIcon(LucideGlobe, "Globe", "cyan");
export const Globe2 = /* @__PURE__ */ appIcon(LucideGlobe2, "Globe2", "cyan");
export const GraduationCap = /* @__PURE__ */ appIcon(LucideGraduationCap, "GraduationCap", "blue");
export const GripVertical = /* @__PURE__ */ appIcon(LucideGripVertical, "GripVertical");
export const Heart = /* @__PURE__ */ appIcon(LucideHeart, "Heart", "rose");
export const History = /* @__PURE__ */ appIcon(LucideHistory, "History");
export const Home = /* @__PURE__ */ appIcon(LucideHome, "Home", "orange");
export const ImagePlus = /* @__PURE__ */ appIcon(LucideImagePlus, "ImagePlus", "violet");
export const Import = /* @__PURE__ */ appIcon(LucideImport, "Import");
export const Info = /* @__PURE__ */ appIcon(LucideInfo, "Info", "blue");
export const Layers = /* @__PURE__ */ appIcon(LucideLayers, "Layers", "violet");
export const LibraryBig = /* @__PURE__ */ appIcon(LucideLibraryBig, "LibraryBig", "violet");
export const Lightbulb = /* @__PURE__ */ appIcon(LucideLightbulb, "Lightbulb", "amber");
export const Link2 = /* @__PURE__ */ appIcon(LucideLink2, "Link2");
export const List = /* @__PURE__ */ appIcon(LucideList, "List");
export const ListOrdered = /* @__PURE__ */ appIcon(LucideListOrdered, "ListOrdered", "teal");
export const LoaderCircle = /* @__PURE__ */ appIcon(LucideLoaderCircle, "LoaderCircle");
export const LogOut = /* @__PURE__ */ appIcon(LucideLogOut, "LogOut", "slate");
export const Mail = /* @__PURE__ */ appIcon(LucideMail, "Mail", "teal");
export const Menu = /* @__PURE__ */ appIcon(LucideMenu, "Menu");
export const MessageSquare = /* @__PURE__ */ appIcon(LucideMessageSquare, "MessageSquare", "teal");
export const Monitor = /* @__PURE__ */ appIcon(LucideMonitor, "Monitor");
export const Moon = /* @__PURE__ */ appIcon(LucideMoon, "Moon");
export const MoreHorizontal = /* @__PURE__ */ appIcon(LucideMoreHorizontal, "MoreHorizontal");
export const Music = /* @__PURE__ */ appIcon(LucideMusic, "Music", "violet");
export const Notebook = /* @__PURE__ */ appIcon(LucideNotebook, "Notebook", "indigo");
export const OctagonAlert = /* @__PURE__ */ appIcon(LucideOctagonAlert, "OctagonAlert", "danger");
export const Orbit = /* @__PURE__ */ appIcon(LucideOrbit, "Orbit");
export const Palette = /* @__PURE__ */ appIcon(LucidePalette, "Palette", "violet");
export const PanelRightClose = /* @__PURE__ */ appIcon(LucidePanelRightClose, "PanelRightClose");
export const PanelRightOpen = /* @__PURE__ */ appIcon(LucidePanelRightOpen, "PanelRightOpen");
export const Pencil = /* @__PURE__ */ appIcon(LucidePencil, "Pencil", "violet");
export const PencilLine = /* @__PURE__ */ appIcon(LucidePencilLine, "PencilLine", "violet");
export const Pin = /* @__PURE__ */ appIcon(LucidePin, "Pin");
export const Plus = /* @__PURE__ */ appIcon(LucidePlus, "Plus");
export const RefreshCcw = /* @__PURE__ */ appIcon(LucideRefreshCcw, "RefreshCcw");
export const RefreshCw = /* @__PURE__ */ appIcon(LucideRefreshCw, "RefreshCw");
export const Rocket = /* @__PURE__ */ appIcon(LucideRocket, "Rocket", "rose");
export const RotateCcw = /* @__PURE__ */ appIcon(LucideRotateCcw, "RotateCcw");
export const RotateCw = /* @__PURE__ */ appIcon(LucideRotateCw, "RotateCw");
export const Save = /* @__PURE__ */ appIcon(LucideSave, "Save", "blue");
export const Search = /* @__PURE__ */ appIcon(LucideSearch, "Search", "teal");
export const Settings = /* @__PURE__ */ appIcon(LucideSettings, "Settings", "slate");
export const Settings2 = /* @__PURE__ */ appIcon(LucideSettings2, "Settings2", "slate");
export const Shield = /* @__PURE__ */ appIcon(LucideShield, "Shield", "indigo");
export const Sparkles = /* @__PURE__ */ appIcon(LucideSparkles, "Sparkles", "rose");
export const Sun = /* @__PURE__ */ appIcon(LucideSun, "Sun");
export const Target = /* @__PURE__ */ appIcon(LucideTarget, "Target", "rose");
export const Trash2 = /* @__PURE__ */ appIcon(LucideTrash2, "Trash2", "danger");
export const TriangleAlert = /* @__PURE__ */ appIcon(LucideTriangleAlert, "TriangleAlert", "warning");
export const UserPlus = /* @__PURE__ */ appIcon(LucideUserPlus, "UserPlus", "blue");
export const UserRound = /* @__PURE__ */ appIcon(LucideUserRound, "UserRound", "blue");
export const Users = /* @__PURE__ */ appIcon(LucideUsers, "Users", "blue");
export const WifiOff = /* @__PURE__ */ appIcon(LucideWifiOff, "WifiOff", "danger");
export const X = /* @__PURE__ */ appIcon(LucideX, "X");
