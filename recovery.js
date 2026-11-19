(() => {
  "use strict";
  const storageKey = "nespoli_concreto_ponto_v1_checkpoints";
  const select = document.querySelector("#recoveryVersions");
  const notice = document.querySelector("#recoveryMessage");
  let copies = [];
  const dateLabel = (date) => new Date(date).toLocaleString("pt-BR");

  document.querySelector("#loadRecoveryBtn").addEventListener("click", async () => {
    notice.textContent = "Procurando cópias anteriores…";
    copies = [];
    select.replaceChildren();
    try {
      const local = JSON.parse(localStorage.getItem(storageKey) || "[]");
      copies.push(...local.map((version) => ({ label: `Neste notebook • ${dateLabel(version.savedAt)}`, data: JSON.parse(version.data) })));
    } catch {
      notice.textContent = "Não foi possível ler as cópias deste notebook.";
    }
    try {
      const response = await fetch("/api/state-history", { cache: "no-store" });
      const result = await response.json();
      if (response.ok) copies.push(...result.versions.map((version) => ({ label: `Nuvem • ${dateLabel(version.updated_at)} • revisão ${version.revision}`, revision: version.revision })));
      else notice.textContent = result.error;
    } catch {
      notice.textContent = "Não foi possível consultar as cópias da nuvem.";
    }
    for (const [index, copy] of copies.entries()) {
      const option = document.createElement("option");
      option.value = index;
      option.textContent = copy.label;
      select.append(option);
    }
    select.disabled = copies.length === 0;
    document.querySelector("#downloadRecoveryBtn").disabled = copies.length === 0;
    if (copies.length) notice.textContent = `${copies.length} cópia(s) disponível(is). Escolha uma para baixar e conferir.`;
    else notice.textContent += " Nenhuma cópia anterior disponível neste acesso.";
  });

  document.querySelector("#downloadRecoveryBtn").addEventListener("click", async () => {
    const copy = copies[Number(select.value)];
    if (!copy) return;
    try {
      let data = copy.data;
      if (!data) {
        const response = await fetch(`/api/state-history?revision=${copy.revision}`, { cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        data = result.data;
      }
      const blob = new Blob([JSON.stringify({ data, exportedAt: new Date().toISOString(), source: copy.label }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `copia-anterior-nespoli-${copy.revision ?? 'notebook'}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notice.textContent = "Cópia baixada para conferência. O sistema continua com os dados atuais.";
    } catch (error) {
      notice.textContent = error.message || "Não foi possível baixar a cópia.";
    }
  });
})();
