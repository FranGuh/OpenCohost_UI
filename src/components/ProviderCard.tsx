import { useEffect, useRef, useState } from "react";
import { Card } from "./ui/Card.js";
import { Badge } from "./ui/Badge.js";
import { Switch } from "./ui/Switch.js";
import { Button } from "./ui/Button.js";
import { Select } from "./ui/Select.js";
import { Segmented } from "./ui/Segmented.js";
import { Alert } from "./ui/Alert.js";
import { ConfirmFooter } from "./ui/ConfirmFooter.js";
import { ApiError } from "../api/client.js";
import {
  LLM_PROVIDER_PRESETS,
  isValidProfileId,
  suggestDuplicateId,
  suggestProfileId,
  useLlmProvider,
  useUpdateLlmProvider
} from "../api/llmProvider.js";
import type { LlmProviderRequest } from "../api/llmProvider.js";

const inputClass =
  "h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60";

const PRESET_IDS = Object.keys(LLM_PROVIDER_PRESETS);

function providerLabel(id: string): string {
  return LLM_PROVIDER_PRESETS[id]?.label ?? id;
}

/**
 * Honest voseo copy per error, NEVER a fake success. For the activation-time
 * 422s we keep the SPECIFIC missing field (design contract: don't collapse them
 * into one generic message). The raw detail is the fallback so an unknown 422
 * still surfaces truthfully. `operation` (F3) picks the generic catch-all
 * copy: a GET failure is a load failure, not a "save" failure. `delete-key`
 * disambiguates the SAME backend detail ("api_key required for active cloud
 * profile"): at activation it means "add a key"; while clearing the active
 * profile's key it means "switch away first" — same safety rule, honest copy.
 */
function providerErrorMessage(
  error: Error | null | undefined,
  operation: "load" | "save" | "delete-key" = "save"
): string {
  if (!error) return "";
  const status = error instanceof ApiError ? error.status : 0;
  const detail = error.message;
  if (status === 0) {
    return "No hay conexión con el backend — ¿se está reiniciando? Probá en unos segundos.";
  }
  if (status === 404) {
    return "El backend en ejecución todavía no tiene proveedores en la nube — cerrá y volvé a abrir la app.";
  }
  if (status === 401 || status === 403) {
    return "Necesitás permisos de operador para cambiar el proveedor.";
  }
  if (status === 422) {
    if (detail.includes("base_url required")) {
      return "Para activar este proveedor en la nube falta la URL base (base_url).";
    }
    if (detail.includes("model required")) {
      return "Para activar este proveedor en la nube falta el modelo.";
    }
    if (detail.includes("api_key required")) {
      // Same backend safety rule ("never leave an active cloud profile
      // keyless"), two honest framings depending on what the operator tried.
      return operation === "delete-key"
        ? "Para borrar la key del proveedor activo, primero cambiá a Local u otro proveedor."
        : "Para activar este proveedor en la nube falta la API key.";
    }
    if (detail === "profile_id required") {
      return "Falta indicar a qué proveedor pertenece este cambio.";
    }
    if (detail === "invalid profile_id") {
      return "El id del proveedor no es válido: usá minúsculas, números y guion bajo. 'local' está reservado.";
    }
    if (detail === "unknown preset") {
      return "El preset elegido no existe.";
    }
    if (detail === "unknown provider") {
      return "Ese proveedor todavía no está configurado.";
    }
    // Profile-deletion ladder (owner amendment 2026-07-24). The UI never SENDS a
    // combined delete+edit and resolves an active delete via a single switch-then-
    // delete PUT, so these normally can't fire from here — but if the backend
    // returns them (older build / a racing client) we still surface them honestly
    // instead of leaking the raw detail. The safety rules stay UNCHANGED.
    if (detail.includes("delete_profile cannot be combined")) {
      return "No se puede combinar la eliminación con cambios del proveedor.";
    }
    if (detail === "unknown profile") {
      return "Ese proveedor ya no existe.";
    }
    if (detail === "cannot delete active profile") {
      return "No podés eliminar el proveedor activo; cambiá a Local primero.";
    }
    return detail; // honest fallback
  }
  if (status === 503) {
    if (detail === "key_store_write_failed") {
      return "No se pudo guardar la API key en el almacén seguro. Probá de nuevo.";
    }
    if (detail === "provider_config_write_failed") {
      return "No se pudo guardar la configuración del proveedor. Probá de nuevo.";
    }
    return "El proveedor no está disponible ahora. Probá de nuevo en un momento.";
  }
  return operation === "load"
    ? "No se pudo cargar la configuración del proveedor."
    : "No se pudo guardar la configuración del proveedor.";
}

/**
 * Proveedor LLM card — wired to GET/PUT /api/llm/provider
 * (multi_provider_llm_20260723). Picks the active provider (Local Ollama or a
 * configured cloud profile), sets failure/spend posture, and configures each
 * per-provider profile (base_url/model/preset + a WRITE-ONLY api_key).
 *
 * SECRET: the api_key input is write-only — it never receives a stored value
 * (there is none to echo, only `api_key_set`) and is cleared after every save,
 * so nothing round-trips. A stored key is signalled by a "key guardada" badge.
 *
 * Draft vs activation: an incomplete INACTIVE profile saves fine (draft);
 * activating it 422s with the specific missing field, surfaced honestly under
 * the active-provider selector. Two mutation instances scope errors to their
 * region (global posture vs profile editor), mirroring ModelCard's
 * one-instance-per-control pattern.
 */
export function ProviderCard() {
  const { data, isError: getError, error: getErrorObj } = useLlmProvider();
  const globalMutation = useUpdateLlmProvider();
  const profileMutation = useUpdateLlmProvider();

  // Provider currently open in the editor. null + !customMode → editor closed.
  const [editId, setEditId] = useState<string | null>(null);
  const [customMode, setCustomMode] = useState(false);
  const [customId, setCustomId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [preset, setPreset] = useState("");
  const [apiKey, setApiKey] = useState("");
  // Which profile-scoped action last fired, so the shared profileMutation error
  // can be framed correctly ("api_key required..." means different things for a
  // save vs. clearing the active profile's key).
  const [profileOp, setProfileOp] = useState<"save" | "delete-key">("save");
  // Delete-provider confirm flow (owner: schema previously had no way to remove
  // a profile). Reset whenever the open profile changes (effect below).
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // "Configurar proveedores" default-open state (owner: local-only users keep
  // the compact view; cloud users see their profiles at a glance). Defaults
  // from whether any profile is already configured on the FIRST data load
  // only — after that the operator toggles freely via onToggle, same as any
  // native <details>.
  const [configOpen, setConfigOpen] = useState(false);
  const configOpenInitialized = useRef(false);

  // Hydrate the editor whenever the open profile changes. A configured profile
  // loads its stored fields; a not-yet-configured preset prefills its base_url;
  // custom starts blank. api_key always starts empty (write-only).
  // ponytail: depend on editId only — data changes solely via our own
  // mutations (no polling), and post-save re-hydration reads api_key_set live
  // from `data` below, so there is no stale-typing wipe to guard against.
  useEffect(() => {
    // Any change of open profile (including close / enter-custom / post-delete)
    // drops a half-open delete confirm so it never lingers onto another profile.
    setConfirmingDelete(false);
    if (editId == null) return;
    const existing = data?.profiles[editId];
    if (existing) {
      setBaseUrl(existing.base_url);
      setModel(existing.model);
      setPreset(existing.preset ?? "");
    } else {
      const presetDef = LLM_PROVIDER_PRESETS[editId];
      setBaseUrl(presetDef?.base_url ?? "");
      setModel("");
      setPreset(presetDef ? editId : "");
    }
    setApiKey("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  // First-load default for "Configurar proveedores": open when profiles
  // already exist, collapsed otherwise. Guarded by a ref (not a dep) so a
  // later refetch (new `data` object, same or different profile count) never
  // re-applies the default over the operator's own toggle.
  useEffect(() => {
    if (!data || configOpenInitialized.current) return;
    configOpenInitialized.current = true;
    setConfigOpen(Object.keys(data.profiles).length > 0);
  }, [data]);

  if (getError) {
    return (
      <Card className="flex flex-col p-4">
        <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
          <h2 className="text-sm font-bold text-foreground">Proveedor LLM</h2>
        </div>
        <Alert tone="danger" className="mt-3.5">
          {providerErrorMessage(getErrorObj ?? undefined, "load")}
        </Alert>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card className="flex flex-col p-4">
        <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
          <h2 className="text-sm font-bold text-foreground">Proveedor LLM</h2>
        </div>
        <p role="status" className="pt-3.5 text-xs leading-relaxed text-dim">
          Cargando…
        </p>
      </Card>
    );
  }

  const configuredIds = Object.keys(data.profiles);
  const addablePresets = PRESET_IDS.filter((id) => !configuredIds.includes(id));

  const activeOptions = [
    { value: "local", label: "Local (Ollama)" },
    ...configuredIds.map((id) => ({ value: id, label: providerLabel(id) }))
  ];

  const activeProvider = data.active_provider;
  const currentApiKeySet = editId != null ? Boolean(data.profiles[editId]?.api_key_set) : false;
  const effectiveId = customMode ? customId.trim() : editId;
  const editorOpen = customMode || editId != null;
  const anyPending = globalMutation.isPending || profileMutation.isPending;

  // After a 422 the inputs stay editable; clear the stale error the moment the
  // operator edits anything so a corrected field isn't shadowed by a dead
  // message (recovery). Cheap no-op when there's no error.
  function resetProfileError() {
    if (profileMutation.isError) profileMutation.reset();
  }

  function selectEdit(id: string) {
    setCustomMode(false);
    setEditId(id);
  }

  function startCustom() {
    setCustomMode(true);
    setEditId(null);
    setCustomId("");
    setBaseUrl("");
    setModel("");
    setPreset("");
    setApiKey("");
  }

  function handlePresetChange(next: string) {
    resetProfileError();
    setPreset(next);
    // Mirror the backend prefill: choosing a preset fills an empty base_url.
    if (next && LLM_PROVIDER_PRESETS[next] && !baseUrl) {
      setBaseUrl(LLM_PROVIDER_PRESETS[next].base_url);
    }
  }

  function activate(id: string) {
    if (id === activeProvider) return;
    globalMutation.mutate({ active_provider: id });
  }

  function saveProfile() {
    if (!effectiveId) return;
    setProfileOp("save");
    const body: LlmProviderRequest = { profile_id: effectiveId, preset: preset || null };
    // F5: when a preset is selected, omit an untouched-empty base_url/model so
    // the backend's preset prefill (settings.py LLM_PROVIDER_PRESETS) can fill
    // them in — sending an explicit "" would overwrite that prefill.
    if (!(preset && baseUrl === "")) body.base_url = baseUrl;
    if (!(preset && model === "")) body.model = model;
    if (apiKey) body.api_key = apiKey; // write-only; omitted when untouched
    profileMutation.mutate(body, {
      onSuccess: () => {
        setApiKey("");
        if (customMode) {
          setCustomMode(false);
          setEditId(effectiveId);
        }
      }
    });
  }

  function deleteKey() {
    if (!editId) return;
    setProfileOp("delete-key");
    profileMutation.mutate({ profile_id: editId, api_key: "" }, { onSuccess: () => setApiKey("") });
  }

  // Remove a configured profile (config entry + stored key). If it's the ACTIVE
  // provider, the backend supports a single switch-then-delete PUT
  // ({active_provider:"local", delete_profile}) so the owner never needs two
  // round trips — deleting the still-active profile alone would 422. The stale
  // "delete_profile" error (if any) renders via profileMutation below; a save
  // frame is fine since the delete details are matched by their own strings.
  function deleteProfile() {
    if (!data || !editId) return;
    setProfileOp("save");
    setConfirmingDelete(false);
    const body: LlmProviderRequest =
      data.active_provider === editId
        ? { active_provider: "local", delete_profile: editId }
        : { delete_profile: editId };
    profileMutation.mutate(body, { onSuccess: () => setEditId(null) });
  }

  // Duplicate a configured profile into a fresh custom draft (owner wants
  // several profiles from one provider — e.g. multiple NVIDIA models). Carries
  // the source base_url/model/preset and a free suggested id; the write-only
  // api_key is NEVER copied — the new profile needs its own key.
  function duplicateProfile() {
    if (!data || !editId) return;
    const src = data.profiles[editId];
    if (!src) return;
    resetProfileError();
    setCustomMode(true);
    setEditId(null);
    setCustomId(suggestDuplicateId(editId, Object.keys(data.profiles)));
    setBaseUrl(src.base_url);
    setModel(src.model);
    setPreset(src.preset ?? "");
    setApiKey("");
  }

  const canSave = Boolean(effectiveId) && isValidProfileId(effectiveId ?? "") && !profileMutation.isPending;

  // A profile that actually EXISTS on the backend (not a custom draft nor an
  // unsaved preset row) is the only thing that can be duplicated or deleted.
  const isConfigured = !customMode && editId != null && Boolean(data.profiles[editId]);
  const editingActive = isConfigured && data.active_provider === editId;
  const editingHasKey = isConfigured && Boolean(editId && data.profiles[editId]?.api_key_set);
  const deleteMessage = editingActive
    ? "Esto cambia a Local y elimina el proveedor y su key. No se puede deshacer."
    : editingHasKey
      ? "Se elimina el proveedor y su key guardada. No se puede deshacer."
      : "Se elimina el proveedor. No se puede deshacer.";

  // Why is Guardar disabled for a custom id? (owner tried "z-ai".) The inline
  // field hint alone was missable — surface an actionable reason NEXT to the
  // button plus a one-click sanitized suggestion ("z-ai" → "z_ai"). suggestedId
  // is "" when nothing usable survives (e.g. "---") → no suggestion offered.
  const customIdTrimmed = customId.trim();
  const customIdInvalid = customMode && customIdTrimmed.length > 0 && !isValidProfileId(customIdTrimmed);
  const suggestedId = customIdInvalid ? suggestProfileId(customIdTrimmed) : "";

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">Proveedor LLM</h2>
        {anyPending && <Badge tone="info">aplicando…</Badge>}
      </div>

      <div className="flex flex-col gap-3.5 pt-3.5">
        {/* Active provider */}
        <div className="grid grid-cols-[1fr_auto] items-center gap-3">
          <span id="provider-active-label" className="text-[13px] text-foreground">
            Proveedor activo
          </span>
          <Select
            options={activeOptions}
            value={data.active_provider}
            onChange={activate}
            disabled={anyPending}
            aria-labelledby="provider-active-label"
            className="w-44"
          />
        </div>
        {globalMutation.isError && (
          <Alert tone="danger">{providerErrorMessage(globalMutation.error)}</Alert>
        )}

        {/* Failure posture */}
        <div className="flex flex-col gap-2 border-t border-border-soft pt-3.5">
          <div className="grid grid-cols-[1fr_auto] items-center gap-3">
            <span className="text-[13px] text-foreground">Si la nube falla</span>
            <Segmented
              options={[
                { value: "auto", label: "Cambiar a local" },
                { value: "manual", label: "Avisar y esperar" }
              ]}
              value={data.fallback_mode}
              onChange={(mode) => globalMutation.mutate({ fallback_mode: mode })}
              ariaLabel="Modo de respaldo ante fallo de la nube"
              disabled={anyPending}
            />
          </div>
          <p className="text-[11px] leading-relaxed text-dim">
            {data.fallback_mode === "auto"
              ? "Si la nube falla, Kira sigue sola con el modelo local."
              : "Si la nube falla, Kira avisa y no responde hasta que lo resuelvas."}
          </p>
        </div>

        {/* Spend posture */}
        <div className="flex flex-col gap-2 border-t border-border-soft pt-3.5">
          <div className="grid grid-cols-[1fr_auto] items-center gap-3">
            <span className="text-[13px] text-foreground">Pregenerar respuestas en la nube</span>
            <Switch
              checked={data.pregen_enabled}
              onChange={(on) => globalMutation.mutate({ pregen_enabled: on })}
              disabled={anyPending}
              aria-label="Pregenerar respuestas en la nube"
            />
          </div>
          <p className="text-[11px] leading-relaxed text-dim">
            Cada pregeneración en la nube consume tokens facturados.
          </p>
        </div>

        {/* Provider configuration */}
        <details
          className="border-t border-border-soft pt-3.5"
          open={configOpen}
          onToggle={(e) => setConfigOpen(e.currentTarget.open)}
        >
          <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
            Configurar proveedores
          </summary>

          <div className="flex flex-col gap-3.5 pt-3.5">
            {/* Provider list */}
            <div className="flex flex-col gap-2">
              {configuredIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={!customMode && editId === id}
                  onClick={() => selectEdit(id)}
                  className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left transition-colors duration-fast ease-io ${
                    !customMode && editId === id ? "border-ring bg-accent-soft" : "border-border bg-card hover:border-primary"
                  }`}
                >
                  <span className="flex flex-col">
                    <span className="text-[13px] font-semibold text-foreground">{providerLabel(id)}</span>
                    <span className="mono text-[11px] text-dim">{data.profiles[id].base_url || "sin URL base"}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    {data.active_provider === id && <Badge tone="ok">activo</Badge>}
                    {data.profiles[id].api_key_set && <Badge tone="neutral">con key</Badge>}
                  </span>
                </button>
              ))}

              {addablePresets.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => selectEdit(id)}
                  className="flex items-center justify-between gap-2 rounded-md border border-dashed border-border px-3 py-2 text-left text-[13px] text-muted-foreground transition-colors duration-fast ease-io hover:border-primary hover:text-foreground"
                >
                  <span>Agregar {LLM_PROVIDER_PRESETS[id].label}</span>
                  <span className="mono text-[11px] text-dim">{LLM_PROVIDER_PRESETS[id].base_url}</span>
                </button>
              ))}

              <button
                type="button"
                onClick={startCustom}
                aria-pressed={customMode}
                className={`rounded-md border border-dashed px-3 py-2 text-left text-[13px] transition-colors duration-fast ease-io ${
                  customMode ? "border-ring text-foreground" : "border-border text-muted-foreground hover:border-primary hover:text-foreground"
                }`}
              >
                Agregar proveedor…
              </button>
            </div>

            {/* Editor */}
            {editorOpen && (
              <div className="flex flex-col gap-3 border-t border-border-soft pt-3.5">
                {customMode && (
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="provider-custom-id" className="text-[13px] text-foreground">
                      Id del proveedor
                    </label>
                    <input
                      id="provider-custom-id"
                      type="text"
                      value={customId}
                      onChange={(e) => {
                        resetProfileError();
                        setCustomId(e.target.value);
                      }}
                      placeholder="mi_proveedor"
                      className={inputClass}
                    />
                    {customId.trim().length > 0 && !isValidProfileId(customId.trim()) && (
                      <p className="text-[11px] leading-relaxed text-warn">
                        Usá minúsculas, números y guion bajo. 'local' está reservado.
                      </p>
                    )}
                  </div>
                )}

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="provider-base-url" className="text-[13px] text-foreground">
                    URL base
                  </label>
                  <input
                    id="provider-base-url"
                    type="text"
                    inputMode="url"
                    value={baseUrl}
                    onChange={(e) => {
                      resetProfileError();
                      setBaseUrl(e.target.value);
                    }}
                    placeholder="https://…/v1"
                    className={inputClass}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="provider-model" className="text-[13px] text-foreground">
                    Modelo
                  </label>
                  <input
                    id="provider-model"
                    type="text"
                    value={model}
                    onChange={(e) => {
                      resetProfileError();
                      setModel(e.target.value);
                    }}
                    placeholder="gpt-… / deepseek-…"
                    className={inputClass}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <span id="provider-preset-label" className="text-[13px] text-foreground">
                    Preset
                  </span>
                  <Select
                    options={[
                      { value: "", label: "(ninguno)" },
                      ...PRESET_IDS.map((id) => ({ value: id, label: LLM_PROVIDER_PRESETS[id].label }))
                    ]}
                    value={preset}
                    onChange={handlePresetChange}
                    aria-labelledby="provider-preset-label"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="provider-api-key" className="text-[13px] text-foreground">
                      API key
                    </label>
                    {currentApiKeySet && <Badge tone="neutral">key guardada</Badge>}
                  </div>
                  <input
                    id="provider-api-key"
                    type="password"
                    autoComplete="off"
                    value={apiKey}
                    onChange={(e) => {
                      resetProfileError();
                      setApiKey(e.target.value);
                    }}
                    placeholder={currentApiKeySet ? "Nueva API key (opcional)" : "API key"}
                    className={inputClass}
                  />
                  <p className="text-[11px] leading-relaxed text-dim">
                    La key se guarda cifrada en tu equipo y nunca se muestra de vuelta.
                  </p>
                </div>

                <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                  <Button type="button" disabled={!canSave} onClick={saveProfile}>
                    Guardar
                  </Button>
                  {currentApiKeySet && (
                    <Button type="button" variant="outline" disabled={profileMutation.isPending} onClick={deleteKey}>
                      Borrar key
                    </Button>
                  )}
                </div>

                {/* Configured-profile lifecycle: duplicate into a new draft, or
                    delete (active → single switch-then-delete PUT). Swaps to a
                    danger ConfirmFooter while confirming, mirroring MemoriaRow. */}
                {isConfigured &&
                  (confirmingDelete ? (
                    <div className="border-t border-border-soft pt-3">
                      <ConfirmFooter
                        active
                        stages={[{ message: deleteMessage, advanceLabel: "Eliminar proveedor" }]}
                        onConfirm={deleteProfile}
                        onCancel={() => setConfirmingDelete(false)}
                        busy={profileMutation.isPending}
                      />
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2 border-t border-border-soft pt-3">
                      <Button type="button" variant="ghost" disabled={profileMutation.isPending} onClick={duplicateProfile}>
                        Duplicar
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={profileMutation.isPending}
                        onClick={() => setConfirmingDelete(true)}
                      >
                        Eliminar proveedor
                      </Button>
                    </div>
                  ))}

                {customIdInvalid && (
                  <p className="text-[11px] leading-relaxed text-warn">
                    No se puede guardar: el id “{customIdTrimmed}” tiene caracteres no permitidos (solo minúsculas,
                    números y guion bajo).
                    {isValidProfileId(suggestedId) && (
                      <>
                        {" "}Probá con{" "}
                        <button
                          type="button"
                          onClick={() => {
                            resetProfileError();
                            setCustomId(suggestedId);
                          }}
                          className="font-semibold text-foreground underline underline-offset-2 hover:text-primary"
                        >
                          {suggestedId}
                        </button>
                        .
                      </>
                    )}
                  </p>
                )}

                {profileMutation.isError && (
                  <Alert tone="danger">{providerErrorMessage(profileMutation.error, profileOp)}</Alert>
                )}
              </div>
            )}
          </div>
        </details>
      </div>
    </Card>
  );
}
