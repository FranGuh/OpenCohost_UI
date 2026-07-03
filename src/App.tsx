const statusItems = [
  { label: "Sistema: error", tone: "red" },
  { label: "Modelo: revisar Ollama", tone: "red" },
  { label: "Mic: conectado", tone: "neutral" },
  { label: "TTS: inactivo", tone: "neutral" },
  { label: "Chat: desconectado", tone: "neutral" },
  { label: "Health: acción requerida", tone: "softRed" },
  { label: "Voz: —", tone: "neutral" }
];

const voiceChips = ["Voz/PTT: listo", "TTS: idle", "Memoria: disponible", "Chat: desconectado"];

export function App() {
  return (
    <main className="min-h-screen min-w-[1360px] bg-[#080d14] p-3.5 text-[#f5f7fb]">
      <section className="flex h-[60px] items-center gap-3 rounded-[18px] border border-white/[0.04] bg-[#0f1722] px-[18px]">
        <div className="mr-1 text-xl font-extrabold text-[#ff565b]">Modelo error</div>
        {statusItems.map((item) => (
          <div
            key={item.label}
            className={[
              "rounded-[14px] px-[17px] py-[10px] text-base leading-none",
              item.tone === "red"
                ? "bg-[#d93b3f]"
                : item.tone === "softRed"
                  ? "bg-[#7d2931] text-[#ffd5d7]"
                  : "bg-[#172438]"
            ].join(" ")}
          >
            {item.label}
          </div>
        ))}
        <div className="ml-auto grid h-11 w-11 place-items-center rounded-xl bg-[#172942] text-[22px] text-[#d6eaff]">
          ⚙
        </div>
      </section>

      <section className="mt-3 grid min-h-[calc(100vh-86px)] grid-cols-[37.5%_1fr] gap-[22px]">
        <aside className="flex flex-col gap-3.5 rounded-[24px] border border-white/[0.035] bg-[#0f1722] p-8">
          <div className="mb-2 flex items-baseline justify-between">
            <h1 className="text-[31px] font-extrabold">Kira</h1>
            <div className="text-base text-[#acc7e5]">Experiencia principal</div>
          </div>

          <div className="grid h-[226px] place-items-center overflow-hidden rounded-[15px] border border-white/[0.03] bg-[#0a1119]">
            <img src="/kira-error.png" alt="Kira avatar" className="max-h-[226px] w-auto object-contain" />
          </div>

          <button className="mt-2.5 grid h-[90px] place-items-center rounded-[9px] bg-[#21845f] text-[29px] font-extrabold text-white/70">
            Hablar
          </button>

          <section className="rounded-[18px] border border-white/[0.03] bg-[#0a1018] p-[18px]">
            <h2 className="text-lg font-extrabold">Respuesta de Kira</h2>
            <div className="mt-3 h-[162px] rounded-[7px] border border-[#26384e] bg-[#070c12] p-3 text-lg text-white">
              Iniciando Kira... esperá unos segundos mientras se prepara.
            </div>
          </section>

          <section className="rounded-[18px] bg-[#111f2c] p-[17px]">
            <h2 className="text-lg font-extrabold">Entrada de voz / PTT</h2>
            <div className="my-3 flex flex-wrap gap-2">
              {voiceChips.map((chip) => (
                <span key={chip} className="rounded-[13px] bg-[#18263a] px-[15px] py-[7px]">
                  {chip}
                </span>
              ))}
            </div>
            <p className="text-[15px] text-[#9fc3e7]">
              Conecta el reconocimiento de voz en tiempo real. PTT requiere LiveAudio activo.
            </p>
          </section>

          <section className="grid grid-cols-[1fr_145px] gap-2.5 rounded-2xl bg-[#111f2c] p-3">
            <div className="h-[35px] rounded-[7px] border border-[#7a7a74] bg-[#3b3d3f] px-2 py-[7px] text-[#c9c9c9]">
              Escribe un mensaje para Kira (contexto o pregunta)...
            </div>
            <button className="grid place-items-center rounded-[7px] bg-[#5e5d5b] text-[#c8c8c8]">
              Enviar a IA
            </button>
          </section>
        </aside>

        <section className="relative rounded-[24px] border border-white/[0.035] bg-[#0f1722] px-4 pb-7 pt-3">
          <nav className="grid grid-cols-5 gap-[7px]">
            {["Configuración", "Stream", "Co-host", "Música", "Avatar / OBS"].map((tab, index) => (
              <div
                key={tab}
                className={[
                  "grid h-11 place-items-center rounded-[10px] text-base font-extrabold",
                  index === 0 ? "bg-[#2f6ca3] text-white" : "bg-[#141f2e] text-[#6f8cac]"
                ].join(" ")}
              >
                {tab}
              </div>
            ))}
          </nav>

          <div className="mx-1 mb-[18px] mt-4 grid grid-cols-3 gap-2">
            {["M/Perfil", "Audio/TTS", "Ayuda"].map((tab, index) => (
              <div
                key={tab}
                className={[
                  "grid h-[34px] place-items-center font-extrabold text-[#6d8baa]",
                  index === 1 ? "rounded-[7px] bg-[#214e78] text-white" : ""
                ].join(" ")}
              >
                {tab}
              </div>
            ))}
          </div>

          <div className="grid gap-5 px-3.5">
            <section className="rounded-2xl bg-[#111c29] px-[13px] py-[22px]">
              <p className="text-[13px] text-[#a8c8ea]">
                LiveAudio es el motor que permite a Kira escuchar tu voz en tiempo real.
              </p>
              <button className="mt-4 grid h-[35px] w-full place-items-center rounded-md bg-[#316fa8] text-base text-[#b8cde1]">
                Conectar LiveAudio
              </button>
            </section>

            <section className="rounded-2xl bg-[#111c29] px-[26px] py-[22px]">
              <h2 className="text-lg font-extrabold">Voz de Kira</h2>
              <div className="mt-5 grid h-[35px] grid-cols-2 overflow-hidden rounded-[7px] bg-[#5d5c59]">
                <div className="grid place-items-center">AR Argentina</div>
                <div className="grid place-items-center bg-[#2b79b8]">🌐 Neutral</div>
              </div>
              <p className="mt-3 text-[13px] text-[#a8c8ea]">Ambas voces son 100% offline (Piper).</p>
              <div className="mt-6 flex items-center gap-3">
                <span className="relative h-[18px] w-[45px] rounded-full bg-[#2d82c8] after:absolute after:left-[21px] after:top-[-4px] after:h-[23px] after:w-[23px] after:rounded-full after:bg-[#d6dbe1]" />
                <span>Solo TTS local (Piper)</span>
              </div>
              <p className="mt-3 text-[13px] text-[#a8c8ea]">
                OFF envía el texto a Edge-TTS (nube) para una voz más natural.
              </p>
              <p className="mt-[52px] text-[13px] text-[#a8c8ea]">
                Velocidad de voz local (Piper). No afecta a Edge-TTS.
              </p>
              <div className="mt-3.5 grid h-[35px] grid-cols-4 overflow-hidden rounded-[7px] bg-[#5d5c59]">
                {["Rápida", "Media", "Calma", "Lenta"].map((speed, index) => (
                  <div key={speed} className={index === 0 ? "grid place-items-center bg-[#2b79b8]" : "grid place-items-center"}>
                    {speed}
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-2xl bg-[#111c29] px-[26px] py-[22px]">
              <h2 className="text-lg font-extrabold">Memoria</h2>
              <button className="mt-5 grid h-[35px] w-full place-items-center rounded-md bg-[#5d5c59] text-white">
                🧹 Limpiar Memoria
              </button>
              <p className="mt-5 text-[13px] text-[#a8c8ea]">
                Kira olvidará el contexto previo de la conversación.
              </p>
            </section>
          </div>

          <div className="absolute bottom-[30px] right-4 top-[120px] w-2.5 rounded-full">
            <div className="h-[94%] w-2.5 rounded-full bg-[#2b79b8]" />
          </div>
          <div className="absolute bottom-[26px] right-9 text-xs text-[#536a82]">
            Faithful polish preview — same product, cleaner hierarchy.
          </div>
        </section>
      </section>
    </main>
  );
}
