import type {
  ComponentPropsWithoutRef,
  ForwardRefExoticComponent,
  RefAttributes,
} from "react";

import { SlidersHorizontalIcon as RawIconAdjustmentsHorizontal } from "@phosphor-icons/react/SlidersHorizontal";
import { WarningCircleIcon as RawIconAlertCircle } from "@phosphor-icons/react/WarningCircle";
import { WarningIcon as RawIconAlertTriangle } from "@phosphor-icons/react/Warning";
import { LightningIcon as RawIconBolt } from "@phosphor-icons/react/Lightning";
import { BriefcaseIcon as RawIconBriefcase } from "@phosphor-icons/react/Briefcase";
import { BroadcastIcon as RawIconBroadcast } from "@phosphor-icons/react/Broadcast";
import { CheckIcon as RawIconCheck } from "@phosphor-icons/react/Check";
import { CaretDownIcon as RawIconChevronDown } from "@phosphor-icons/react/CaretDown";
import { ClipboardIcon as RawIconClipboard } from "@phosphor-icons/react/Clipboard";
import { CloudIcon as RawIconCloud } from "@phosphor-icons/react/Cloud";
import { CodeIcon as RawIconCode } from "@phosphor-icons/react/Code";
import { CopyIcon as RawIconCopy } from "@phosphor-icons/react/Copy";
import { CpuIcon as RawIconCpu } from "@phosphor-icons/react/Cpu";
import { CrownIcon as RawIconCrown } from "@phosphor-icons/react/Crown";
import { DesktopIcon as RawIconDeviceDesktop } from "@phosphor-icons/react/Desktop";
import { GearIcon as RawIconDeviceDesktopCog } from "@phosphor-icons/react/Gear";
import { DotsThreeIcon as RawIconDots } from "@phosphor-icons/react/DotsThree";
import { DownloadSimpleIcon as RawIconDownload } from "@phosphor-icons/react/DownloadSimple";
import { ArrowSquareOutIcon as RawIconExternalLink } from "@phosphor-icons/react/ArrowSquareOut";
import { FileAudioIcon as RawIconFileMusic } from "@phosphor-icons/react/FileAudio";
import { GaugeIcon as RawIconGauge } from "@phosphor-icons/react/Gauge";
import { HeadphonesIcon as RawIconHeadphones } from "@phosphor-icons/react/Headphones";
import { QuestionIcon as RawIconHelpCircle } from "@phosphor-icons/react/Question";
import { HouseIcon as RawIconHome } from "@phosphor-icons/react/House";
import { InfoIcon as RawIconInfoCircle } from "@phosphor-icons/react/Info";
import { KeyboardIcon as RawIconKeyboard } from "@phosphor-icons/react/Keyboard";
import { TranslateIcon as RawIconLanguage } from "@phosphor-icons/react/Translate";
import { ListChecksIcon as RawIconListCheck } from "@phosphor-icons/react/ListChecks";
import { SpinnerGapIcon as RawIconLoader2 } from "@phosphor-icons/react/SpinnerGap";
import { SignOutIcon as RawIconLogout } from "@phosphor-icons/react/SignOut";
import { EnvelopeIcon as RawIconMail } from "@phosphor-icons/react/Envelope";
import { ChatCircleIcon as RawIconMessage } from "@phosphor-icons/react/ChatCircle";
import { MicrophoneIcon as RawIconMicrophone } from "@phosphor-icons/react/Microphone";
import { MoonIcon as RawIconMoon } from "@phosphor-icons/react/Moon";
import { PencilSimpleIcon as RawIconPencil } from "@phosphor-icons/react/PencilSimple";
import { PhoneCallIcon as RawIconPhoneCall } from "@phosphor-icons/react/PhoneCall";
import { PlayIcon as RawIconPlayerPlay } from "@phosphor-icons/react/Play";
import { PlusIcon as RawIconPlus } from "@phosphor-icons/react/Plus";
import { ArrowClockwiseIcon as RawIconRefresh } from "@phosphor-icons/react/ArrowClockwise";
import { ArrowsClockwiseIcon as RawIconRotate2 } from "@phosphor-icons/react/ArrowsClockwise";
import { MagnifyingGlassIcon as RawIconSearch } from "@phosphor-icons/react/MagnifyingGlass";
import { HardDrivesIcon as RawIconServer } from "@phosphor-icons/react/HardDrives";
import { SparkleIcon as RawIconSparkles } from "@phosphor-icons/react/Sparkle";
import { SpeakerHighIcon as RawIconSpeakerphone } from "@phosphor-icons/react/SpeakerHigh";
import { SquareIcon as RawIconSquare } from "@phosphor-icons/react/Square";
import { SunIcon as RawIconSun } from "@phosphor-icons/react/Sun";
import { TargetIcon as RawIconTargetArrow } from "@phosphor-icons/react/Target";
import { TrashIcon as RawIconTrash } from "@phosphor-icons/react/Trash";
import { TextTIcon as RawIconTypography } from "@phosphor-icons/react/TextT";
import { UserIcon as RawIconUser } from "@phosphor-icons/react/User";
import { SpeakerHighIcon as RawIconVolume } from "@phosphor-icons/react/SpeakerHigh";
import { XIcon as RawIconX } from "@phosphor-icons/react/X";

export interface IconProps
  extends Omit<ComponentPropsWithoutRef<"svg">, "stroke">,
    RefAttributes<SVGSVGElement> {
  alt?: string;
  color?: string;
  mirrored?: boolean;
  size?: number | string;
  stroke?: number | string;
  title?: string;
  weight?: "thin" | "light" | "regular" | "bold" | "fill" | "duotone";
}

export type Icon = ForwardRefExoticComponent<IconProps>;

const IconAdjustmentsHorizontal = RawIconAdjustmentsHorizontal as Icon;
const IconAlertCircle = RawIconAlertCircle as Icon;
const IconAlertTriangle = RawIconAlertTriangle as Icon;
const IconBolt = RawIconBolt as Icon;
const IconBriefcase = RawIconBriefcase as Icon;
const IconBroadcast = RawIconBroadcast as Icon;
const IconCheck = RawIconCheck as Icon;
const IconChevronDown = RawIconChevronDown as Icon;
const IconClipboard = RawIconClipboard as Icon;
const IconCloud = RawIconCloud as Icon;
const IconCode = RawIconCode as Icon;
const IconCopy = RawIconCopy as Icon;
const IconCpu = RawIconCpu as Icon;
const IconCrown = RawIconCrown as Icon;
const IconDeviceDesktop = RawIconDeviceDesktop as Icon;
const IconDeviceDesktopCog = RawIconDeviceDesktopCog as Icon;
const IconDots = RawIconDots as Icon;
const IconDownload = RawIconDownload as Icon;
const IconExternalLink = RawIconExternalLink as Icon;
const IconFileMusic = RawIconFileMusic as Icon;
const IconGauge = RawIconGauge as Icon;
const IconHeadphones = RawIconHeadphones as Icon;
const IconHelpCircle = RawIconHelpCircle as Icon;
const IconHome = RawIconHome as Icon;
const IconInfoCircle = RawIconInfoCircle as Icon;
const IconKeyboard = RawIconKeyboard as Icon;
const IconLanguage = RawIconLanguage as Icon;
const IconListCheck = RawIconListCheck as Icon;
const IconLoader2 = RawIconLoader2 as Icon;
const IconLogout = RawIconLogout as Icon;
const IconMail = RawIconMail as Icon;
const IconMessage = RawIconMessage as Icon;
const IconMicrophone = RawIconMicrophone as Icon;
const IconMoon = RawIconMoon as Icon;
const IconPencil = RawIconPencil as Icon;
const IconPhoneCall = RawIconPhoneCall as Icon;
const IconPlayerPlay = RawIconPlayerPlay as Icon;
const IconPlus = RawIconPlus as Icon;
const IconRefresh = RawIconRefresh as Icon;
const IconRotate2 = RawIconRotate2 as Icon;
const IconSearch = RawIconSearch as Icon;
const IconServer = RawIconServer as Icon;
const IconSparkles = RawIconSparkles as Icon;
const IconSpeakerphone = RawIconSpeakerphone as Icon;
const IconSquare = RawIconSquare as Icon;
const IconSun = RawIconSun as Icon;
const IconTargetArrow = RawIconTargetArrow as Icon;
const IconTrash = RawIconTrash as Icon;
const IconTypography = RawIconTypography as Icon;
const IconUser = RawIconUser as Icon;
const IconVolume = RawIconVolume as Icon;
const IconX = RawIconX as Icon;

export {
  IconAdjustmentsHorizontal,
  IconAlertCircle,
  IconAlertTriangle,
  IconBolt,
  IconBriefcase,
  IconBroadcast,
  IconCheck,
  IconChevronDown,
  IconClipboard,
  IconCloud,
  IconCode,
  IconCopy,
  IconCpu,
  IconCrown,
  IconDeviceDesktop,
  IconDeviceDesktopCog,
  IconDots,
  IconDownload,
  IconExternalLink,
  IconFileMusic,
  IconGauge,
  IconHeadphones,
  IconHelpCircle,
  IconHome,
  IconInfoCircle,
  IconKeyboard,
  IconLanguage,
  IconListCheck,
  IconLoader2,
  IconLogout,
  IconMail,
  IconMessage,
  IconMicrophone,
  IconMoon,
  IconPencil,
  IconPhoneCall,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconRotate2,
  IconSearch,
  IconServer,
  IconSparkles,
  IconSpeakerphone,
  IconSquare,
  IconSun,
  IconTargetArrow,
  IconTrash,
  IconTypography,
  IconUser,
  IconVolume,
  IconX,
};
