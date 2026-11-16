import { agendaEs } from "./bundles/agenda.es.js";
import { agendaEn } from "./bundles/agenda.en.js";
import { commandsEs } from "./bundles/commands.es.js";
import { commandsEn } from "./bundles/commands.en.js";
import { controlesEs } from "./bundles/controles.es.js";
import { controlesEn } from "./bundles/controles.en.js";
import { experienciaEs } from "./bundles/experiencia.es.js";
import { experienciaEn } from "./bundles/experiencia.en.js";
import { modelsEs } from "./bundles/models.es.js";
import { modelsEn } from "./bundles/models.en.js";
import { musicaEs } from "./bundles/musica.es.js";
import { musicaEn } from "./bundles/musica.en.js";
import { perfilesEs } from "./bundles/perfiles.es.js";
import { perfilesEn } from "./bundles/perfiles.en.js";
import { remoteEs } from "./bundles/remote.es.js";
import { remoteEn } from "./bundles/remote.en.js";
import { setupEs } from "./bundles/setup.es.js";
import { setupEn } from "./bundles/setup.en.js";
import { shellEs } from "./bundles/shell.es.js";
import { shellEn } from "./bundles/shell.en.js";
import { streamEs } from "./bundles/stream.es.js";
import { streamEn } from "./bundles/stream.en.js";
import { uiEs } from "./bundles/ui.es.js";
import { uiEn } from "./bundles/ui.en.js";

export const ES = {
  ...agendaEs,
  ...commandsEs,
  ...controlesEs,
  ...experienciaEs,
  ...modelsEs,
  ...musicaEs,
  ...perfilesEs,
  ...remoteEs,
  ...setupEs,
  ...shellEs,
  ...streamEs,
  ...uiEs
};

export const EN: Record<keyof typeof ES, string> = {
  ...agendaEn,
  ...commandsEn,
  ...controlesEn,
  ...experienciaEn,
  ...modelsEn,
  ...musicaEn,
  ...perfilesEn,
  ...remoteEn,
  ...setupEn,
  ...shellEn,
  ...streamEn,
  ...uiEn
};

export type TKey = keyof typeof ES;
