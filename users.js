(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const dialog = $("#usersDialog");
  const form = $("#userForm");
  let me = null;
  let users = [];
  let saving = false;
  const message = (text, isError = false) => {
    $("#usersMessage").textContent = text;
    $("#usersMessage").classList.toggle("error-text", isError);
  };

  async function api(path, options = {}) {
    const response = await fetch(path, { ...options, cache: "no-store", headers: { "Content-Type": "application/json", ...options.headers } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Falha ao acessar os usuários.");
    return result;
  }

  async function loadIdentity() {
    const result = await api("/api/me");
    me = result.user;
    $("#currentUserName").textContent = result.needsSetup ? "Cadastrar usuários" : `Acesso de ${me.name}`;
    $("#usersBtn").hidden = !["admin", "setup"].includes(me.role);
    return result;
  }

  function selectTab(name) {
    for (const tab of dialog.querySelectorAll("[data-users-tab]")) {
      tab.setAttribute("aria-selected", String(tab.dataset.usersTab === name));
    }
    $("#userRegistration").hidden = name !== "registration";
    $("#userDirectory").hidden = name !== "directory";
  }

  function resetForm() {
    form.reset();
    $("#userId").value = "";
    $("#userRevision").value = "";
    $("#userPassword").required = true;
    $("#userRole").value = me?.role === "setup" ? "admin" : "operator";
    $("#userRole").disabled = me?.role === "setup";
    $("#setupPasswordField").hidden = me?.role !== "setup";
    $("#setupPassword").required = me?.role === "setup";
    $("#userActive").checked = true;
    $("#userActiveField").hidden = true;
    $("#userPasswordHelp").textContent = "Escolha uma senha com pelo menos 10 caracteres.";
    $("#saveUserBtn").textContent = me?.role === "setup" ? "Criar meu acesso de administrador" : "Cadastrar usuário";
    message("");
  }

  function renderDirectory() {
    const list = $("#usersList");
    list.replaceChildren();
    $("#usersCount").textContent = `${users.length} de 3 pessoas cadastradas`;
    for (const user of users) {
      const item = document.createElement("div");
      item.className = "user-account-row";
      const info = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = user.name;
      const details = document.createElement("small");
      details.textContent = `${user.login} • ${user.role === "admin" ? "Administrador" : "Operador"} • ${user.active ? "Ativo" : "Desativado"}`;
      info.append(name, details);
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "mini-btn";
      edit.textContent = "Editar / redefinir senha";
      edit.addEventListener("click", () => {
        resetForm();
        $("#userId").value = user.id;
        $("#userRevision").value = user.revision;
        $("#userName").value = user.name;
        $("#userLogin").value = user.login;
        $("#userRole").value = user.role;
        $("#userActive").checked = user.active;
        $("#userActiveField").hidden = false;
        $("#userPassword").required = false;
        $("#userPasswordHelp").textContent = "Para manter a senha atual, deixe o campo vazio. Para trocar, informe pelo menos 10 caracteres.";
        $("#saveUserBtn").textContent = "Salvar usuário";
        selectTab("registration");
      });
      item.append(info, edit);
      list.append(item);
    }
  }

  async function loadUsers() {
    users = (await api("/api/users")).users;
    renderDirectory();
  }

  $("#usersBtn").addEventListener("click", async () => {
    try {
      await loadIdentity();
      await loadUsers();
      resetForm();
      selectTab(me.role === "setup" || users.length < 3 ? "registration" : "directory");
      dialog.showModal();
    } catch (error) {
      $("#currentUserName").textContent = error.message;
    }
  });
  for (const tab of dialog.querySelectorAll("[data-users-tab]")) {
    tab.addEventListener("click", () => selectTab(tab.dataset.usersTab));
  }
  $("#newUserBtn").addEventListener("click", () => { resetForm(); selectTab("registration"); });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saving || !form.reportValidity()) return;
    if ($("#userPassword").value !== $("#userPasswordConfirm").value) return message("As duas senhas precisam ser iguais.", true);
    const id = $("#userId").value;
    if (!id && users.length >= 3) return message("Os três usuários já estão cadastrados. Edite um cadastro na outra aba.", true);
    saving = true;
    $("#saveUserBtn").disabled = true;
    message("Salvando usuário…");
    try {
      await api("/api/users", {
        method: id ? "PATCH" : "POST",
        body: JSON.stringify({ id, revision: Number($("#userRevision").value), name: $("#userName").value, login: $("#userLogin").value,
          role: $("#userRole").value, password: $("#userPassword").value, setupPassword: $("#setupPassword").value, active: $("#userActive").checked })
      });
      await loadIdentity();
      await loadUsers();
      resetForm();
      selectTab("directory");
      message("Usuário salvo. Cada pessoa já pode entrar com seu próprio login.");
    } catch (error) {
      message(error.message, true);
    } finally {
      saving = false;
      $("#saveUserBtn").disabled = false;
    }
  });
  dialog.addEventListener("close", () => { $("#userPassword").value = ""; $("#userPasswordConfirm").value = ""; $("#setupPassword").value = ""; });
  loadIdentity().catch((error) => { $("#currentUserName").textContent = error.message; });
})();
