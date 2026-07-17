// Central message registry. Each area lives in its own file under ./dict so that
// translations can be added per-feature without merge conflicts; they are merged
// here into one typed lookup. To add a new area: create ./dict/<area>.ts exporting
// `as const`, import it, and spread it into MESSAGES below.
import { common } from "./dict/common";
import { settingsGeneral } from "./dict/settingsGeneral";
import { settingsModels } from "./dict/settingsModels";
import { settingsTabsMisc } from "./dict/settingsTabsMisc";
import { settingsRest } from "./dict/settingsRest";
import { widget } from "./dict/widget";
import { components } from "./dict/components";
import { libMessages } from "./dict/libMessages";
import { summary } from "./dict/summary";

export const MESSAGES = {
  ...common,
  ...settingsGeneral,
  ...settingsModels,
  ...settingsTabsMisc,
  ...settingsRest,
  ...widget,
  ...components,
  ...libMessages,
  ...summary,
} as const;

export type MsgKey = keyof typeof MESSAGES;
