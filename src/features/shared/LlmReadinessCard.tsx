import { useState } from "react";
import { Check, Copy, Cpu, ExternalLink, HardDrive, RefreshCw, Terminal, X } from "lucide-react";
import { Card } from "../../ui/Card.js";
import { Badge, type BadgeTone } from "../../ui/Badge.js";
import { Button } from "../../ui/Button.js";
import { Input } from "../../ui/Input.js";
import { Segmented } from "../../ui/Segmented.js";
import { Alert } from "../../ui/Alert.js";
import { useLlmReadiness } from "./useLlmReadiness.js";
import {
  LLM_PROVIDER_PRESETS,
  useLlmProvider,
  useTriggerCloudProbe,
  useUpdateLlmProvider
} from "../../api/llmProvider.js";
import { useT } from "../../i18n/t.js";
import { cn } from "../../lib/cn.js";

export interface LlmReadinessCardProps {
  onClose?: () => void;
  className?: string;
  showDismiss?: boolean;
}

export function LlmReadinessCard({ onClose, className, showDismiss = false }: LlmReadinessCardProps) {
  const t = useT();
  const { readiness, state, canChat, isReady, refetch } = useLlmReadiness({
    activePolling: true
  });

  const { data: providerConfig } = useLlmProvider();
  const updateProvider = useUpdateLlmProvider();
  const triggerProbe = useTriggerCloudProbe();

  const [mode, setMode] = useState<"local" | "cloud">("local");
  const [copied, setCopied] = useState(false);
  const [isManualChecking, setIsManualChecking] = useState(false);

  // Cloud form state
  const [cloudView, setCloudView] = useState<"list" | "add">("list");
  const [cloudPreset, setCloudPreset] = useState("openai");
  const [modelInput, setModelInput] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");

  const recommendedModel = readiness?.hardware?.recommended_model ?? "gemma4:e4b";
  const runCommand = `ollama run ${recommendedModel}`;

  let badgeTone: BadgeTone = "ok";
  let badgeLabel = t("controles.readiness.readyMsg");

  if (isReady) {
    badgeTone = "ok";
    badgeLabel = "Listo";
  } else if (state === "LOCAL_OLLAMA_MISSING") {
    badgeTone = "danger";
    badgeLabel = "Ollama offline";
  } else if (state === "LOCAL_OLLAMA_OFFLINE") {
    badgeTone = "warn";
    badgeLabel = "Ollama detenido";
  } else if (state === "LOCAL_NO_MODELS") {
    badgeTone = "warn";
    badgeLabel = "Sin modelos";
  } else if (state === "LOCAL_MODEL_MISSING") {
    badgeTone = "warn";
    badgeLabel = "Modelo faltante";
  } else if (state.startsWith("CLOUD_")) {
    badgeTone = "info";
    badgeLabel = "Nube";
  }

  function handleCopyCommand() {
    void navigator.clipboard.writeText(runCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleManualRefresh() {
    setIsManualChecking(true);
    try {
      await refetch();
    } finally {
      setIsManualChecking(false);
    }
  }

  async function handleSaveCloudKey() {
    if (!apiKeyInput.trim()) return;
    const model = modelInput.trim() || (cloudPreset === "openai" ? "gpt-4o-mini" : "meta/llama-3.1-70b-instruct");
    await updateProvider.mutateAsync({
      active_provider: cloudPreset,
      profile_id: cloudPreset,
      preset: cloudPreset,
      model,
      api_key: apiKeyInput.trim()
    });
    setApiKeyInput("");
    setModelInput("");
    setCloudView("list");
  }

  const configuredProfiles = Object.entries(providerConfig?.profiles ?? {});
  const isAddingProvider = cloudView === "add" || configuredProfiles.length === 0;

  return (
    <Card className={cn("flex flex-col gap-4 p-4", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
        <div className="flex items-center gap-2">
          <Terminal className="text-primary" size={16} aria-hidden="true" />
          <h2 className="text-sm font-bold text-foreground">{t("controles.readiness.title")}</h2>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={badgeTone}>{badgeLabel}</Badge>
          {showDismiss && onClose && (
            <Button
              variant="ghost"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              onClick={onClose}
              aria-label={t("controles.readiness.close")}
            >
              <X size={14} aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>

      <Segmented
        ariaLabel="Modo de ejecución"
        value={mode}
        onChange={setMode}
        options={[
          { value: "local", label: t("controles.readiness.localTab") },
          { value: "cloud", label: t("controles.readiness.cloudTab") }
        ]}
      />

      {mode === "local" ? (
        <div className="flex flex-col gap-3.5">
          <p className="text-xs text-muted-foreground leading-relaxed">
            OpenCohost necesita conectarse a un modelo de lenguaje para chatear. Con Ollama puedes ejecutar modelos de forma 100% local y privada en tu PC.
          </p>

          {isReady ? (
            <Alert tone="ok" title={t("controles.readiness.readyMsg")}>
              Ollama está conectado y el modelo <span className="mono font-semibold">{readiness?.selected_model}</span> está listo para chatear.
            </Alert>
          ) : state === "LOCAL_OLLAMA_OFFLINE" ? (
            <Alert tone="warn" title="Ollama instalado pero detenido">
              Detectamos Ollama en tu equipo, pero el servicio en segundo plano no responde en http://127.0.0.1:11434.
            </Alert>
          ) : state === "LOCAL_OLLAMA_MISSING" ? (
            <Alert tone="danger" title="Ollama no detectado">
              Instala Ollama en tu sistema para poder usar modelos locales sin conexión a internet.
            </Alert>
          ) : state === "LOCAL_NO_MODELS" ? (
            <Alert tone="warn" title="Ollama activo pero sin modelos">
              Ollama está funcionando, pero aún no has descargado ningún modelo de lenguaje.
            </Alert>
          ) : (
            <Alert tone="warn" title="Modelo activo no instalado">
              El modelo seleccionado (<span className="mono">{readiness?.selected_model}</span>) no está instalado en tu disco.
            </Alert>
          )}

          {/* Hardware summary chips */}
          <div className="grid grid-cols-2 gap-2 rounded-md border border-border-soft bg-surface-2 p-3 text-xs">
            <div className="flex items-center gap-2">
              <Cpu size={14} className="text-dim" aria-hidden="true" />
              <div>
                <p className="text-dim text-[11px]">{t("controles.readiness.gpu")}</p>
                <p className="font-semibold text-foreground">{readiness?.hardware?.gpu_name ?? "CPU / Integrada"}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <HardDrive size={14} className="text-dim" aria-hidden="true" />
              <div>
                <p className="text-dim text-[11px]">{t("controles.readiness.vram")}</p>
                <p className="font-semibold text-foreground">
                  {readiness?.hardware?.total_vram_mb
                    ? `${(readiness.hardware.total_vram_mb / 1024).toFixed(1)} GB`
                    : "—"}
                </p>
              </div>
            </div>
          </div>

          {/* Contextual guidance according to state */}
          {state === "LOCAL_OLLAMA_OFFLINE" ? (
            <div className="flex flex-col gap-2 rounded-md border border-border-soft bg-card p-3 text-xs">
              <p className="font-semibold text-foreground">Cómo iniciar el servicio de Ollama:</p>
              <ul className="list-disc pl-4 text-muted-foreground space-y-1">
                <li>Abre la aplicación <strong>Ollama</strong> desde el Menú Inicio de Windows.</li>
                <li>O ejecuta <code className="mono bg-surface-2 px-1 py-0.5 rounded text-foreground font-semibold">ollama serve</code> en tu terminal (PowerShell o CMD).</li>
              </ul>
              {readiness?.ollama?.binary_path && (
                <p className="text-[11px] text-muted-foreground pt-1 truncate">
                  Ejecutable detectado: <span className="mono">{readiness.ollama.binary_path}</span>
                </p>
              )}
              {readiness?.ollama?.in_path === false && (
                <p className="text-[11px] text-amber-500 font-medium">
                  Nota: Ollama no está en tu variable PATH del sistema. Recomendamos abrirlo directamente desde el Menú Inicio.
                </p>
              )}
            </div>
          ) : state === "LOCAL_OLLAMA_MISSING" ? (
            <div className="flex flex-col gap-2 rounded-md border border-border-soft bg-card p-3">
              <p className="text-xs text-muted-foreground">{t("controles.readiness.ollamaStep1")}</p>
              <a
                href="https://ollama.com/download"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
              >
                https://ollama.com/download <ExternalLink size={12} aria-hidden="true" />
              </a>
              <p className="text-[11px] text-muted-foreground">
                Una vez instalado, abre Ollama y presiona "Comprobar conexión".
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2 rounded-md border border-border-soft bg-card p-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-semibold text-foreground">
                  {isReady ? "Comando del modelo activo:" : "Ejecutar en tu terminal externa (fuera de OpenCohost):"}
                </span>
                <span className="text-[11px] text-muted-foreground leading-normal">
                  {isReady
                    ? "Este comando te permite interactuar con el modelo y descargarlo directamente desde una terminal externa a OpenCohost."
                    : "Abre PowerShell, CMD o Windows Terminal y ejecuta este comando para descargar el modelo. OpenCohost lo detectará al terminar:"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 rounded-md bg-surface-2 p-2 mono text-xs text-foreground">
                <code className="select-all font-semibold">{runCommand}</code>
                <Button
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={handleCopyCommand}
                  aria-label={t("controles.readiness.copyCommand")}
                >
                  {copied ? (
                    <span className="flex items-center gap-1 text-ok">
                      <Check size={12} aria-hidden="true" /> {t("controles.readiness.copied")}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <Copy size={12} aria-hidden="true" /> {t("controles.readiness.copyCommand")}
                    </span>
                  )}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Si necesitas un ajuste detallado, ve a <span className="font-semibold text-foreground">Controles → Perfil y modelo</span>.
              </p>
            </div>
          )}

          {/* Alternative recommendation for low VRAM or unconfigured Ollama */}
          {!isReady && (
            <div className="flex flex-col gap-2 rounded-md border border-primary/25 bg-primary/5 p-3 text-xs">
              <span className="font-semibold text-foreground">
                ¿Poca VRAM o prefieres no instalar Ollama?
              </span>
              <p className="text-muted-foreground leading-relaxed">
                Si tu equipo no tiene suficiente tarjeta gráfica o prefieres no descargar gigabytes de modelos, te recomendamos usar el <strong>Modo Nube</strong> con tu propia API key (OpenAI o NVIDIA NIM). Es más ligero y veloz.
              </p>
              <div>
                <Button
                  variant="outline"
                  className="h-7 text-xs border-primary/40 text-primary hover:bg-primary/10"
                  onClick={() => setMode("cloud")}
                >
                  Configurar Modo Nube →
                </Button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            {providerConfig?.active_provider !== "local" ? (
              <Button
                variant="outline"
                className="text-xs"
                disabled={updateProvider.isPending}
                onClick={() => void updateProvider.mutateAsync({ active_provider: "local" })}
              >
                Activar Ollama Local
              </Button>
            ) : <div />}

            <Button
              variant="outline"
              disabled={isManualChecking}
              onClick={() => void handleManualRefresh()}
              className="text-xs"
            >
              <RefreshCw size={12} className={cn("mr-1.5", isManualChecking && "animate-spin")} aria-hidden="true" />
              {isManualChecking ? t("controles.readiness.checking") : t("controles.readiness.refresh")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3.5">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Conecta tu propia API Key de cualquier proveedor compatible con OpenAI o NVIDIA NIM para chatear sin consumir recursos de tu ordenador.
          </p>

          {/* VIEW A: List of Configured Profiles */}
          {!isAddingProvider && (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
                  Proveedores configurados ({configuredProfiles.length})
                </span>
                <Button
                  variant="outline"
                  className="h-7 px-2.5 text-xs text-primary border-primary/40 hover:bg-primary/10"
                  onClick={() => setCloudView("add")}
                >
                  + Añadir proveedor
                </Button>
              </div>

              <div className="flex flex-col gap-2">
                {configuredProfiles.map(([profileId, prof]) => {
                  const isActive = providerConfig?.active_provider === profileId;
                  const presetInfo = LLM_PROVIDER_PRESETS[prof.preset as keyof typeof LLM_PROVIDER_PRESETS];
                  const label = presetInfo?.label ?? profileId;
                  return (
                    <div
                      key={profileId}
                      className={cn(
                        "flex items-center justify-between gap-3 rounded-md border p-2.5 text-xs transition-colors",
                        isActive
                          ? "border-primary/50 bg-primary/5"
                          : "border-border-soft bg-surface-2"
                      )}
                    >
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground truncate">{label}</span>
                          {isActive ? (
                            <Badge tone="ok">ACTIVO</Badge>
                          ) : (
                            <span className="text-[10px] text-muted-foreground uppercase">Inactivo</span>
                          )}
                        </div>
                        <span className="mono text-[11px] text-muted-foreground truncate">{prof.model}</span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {!isActive && (
                          <Button
                            variant="outline"
                            className="h-7 px-2.5 text-xs"
                            disabled={updateProvider.isPending}
                            onClick={() => void updateProvider.mutateAsync({ active_provider: profileId })}
                          >
                            Activar
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-danger hover:bg-danger-bg"
                          disabled={updateProvider.isPending}
                          onClick={() => void updateProvider.mutateAsync({ delete_profile: profileId })}
                          aria-label={`Eliminar perfil ${profileId}`}
                        >
                          <X size={14} aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between pt-1">
                <Button
                  variant="outline"
                  disabled={triggerProbe.isPending}
                  onClick={() => void triggerProbe.mutateAsync()}
                  className="text-xs"
                >
                  Probar conexión activa
                </Button>
                {triggerProbe.isSuccess && (
                  <span className={cn("text-xs font-medium", triggerProbe.data?.armed ? "text-ok" : "text-warn")}>
                    {triggerProbe.data?.armed ? "✓ Conexión exitosa" : `Fallo: ${triggerProbe.data?.reason ?? "desconocido"}`}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* VIEW B: Add / Edit Profile Form */}
          {isAddingProvider && (
            <div className="flex flex-col gap-3 rounded-md border border-border-soft bg-card p-3">
              <div className="flex items-center justify-between pb-1 border-b border-border-soft">
                <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
                  {configuredProfiles.length > 0 ? "Añadir nuevo proveedor" : "Configurar proveedor inicial"}
                </span>
                {configuredProfiles.length > 0 && (
                  <Button
                    variant="ghost"
                    className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setCloudView("list")}
                  >
                    ← Volver
                  </Button>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <label htmlFor="cloud-preset-select" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
                  Proveedor Cloud
                </label>
                <select
                  id="cloud-preset-select"
                  value={cloudPreset}
                  onChange={(e) => {
                    const nextPreset = e.target.value;
                    setCloudPreset(nextPreset);
                    if (nextPreset === "openai") setModelInput("gpt-4o-mini");
                    else if (nextPreset === "nvidia_nim") setModelInput("meta/llama-3.1-70b-instruct");
                  }}
                  className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                >
                  {Object.entries(LLM_PROVIDER_PRESETS).map(([id, preset]) => (
                    <option key={id} value={id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-2">
                <label htmlFor="cloud-model-input" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
                  Modelo
                </label>
                <Input
                  id="cloud-model-input"
                  placeholder={cloudPreset === "openai" ? "gpt-4o-mini" : "meta/llama-3.1-70b-instruct"}
                  value={modelInput}
                  onChange={(e) => setModelInput(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <label htmlFor="cloud-api-key" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
                  API Key ({cloudPreset})
                </label>
                <Input
                  id="cloud-api-key"
                  type="password"
                  placeholder="sk-..."
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                />
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <Button
                  variant="outline"
                  disabled={triggerProbe.isPending}
                  onClick={() => void triggerProbe.mutateAsync()}
                  className="text-xs"
                >
                  Probar conexión
                </Button>
                <Button
                  variant="primary"
                  disabled={!apiKeyInput.trim() || updateProvider.isPending}
                  onClick={() => void handleSaveCloudKey()}
                  className="text-xs"
                >
                  Guardar y Activar
                </Button>
              </div>

              {triggerProbe.isSuccess && (
                <Alert tone={triggerProbe.data?.armed ? "ok" : "warn"}>
                  {triggerProbe.data?.armed ? "Proveedor conectado con éxito." : `No se pudo conectar: ${triggerProbe.data?.reason ?? "desconocido"}`}
                </Alert>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
