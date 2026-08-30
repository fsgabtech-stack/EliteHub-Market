async function confirmarEmail() {
  const status = document.getElementById("status");
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
  if (!token || !status) {
    if (status) status.textContent = "Link de confirmação inválido.";
    return;
  }
  try {
    const csrf = await fetch("/api/v1/security/csrf", { credentials: "same-origin" });
    if (!csrf.ok) throw new Error("csrf");
    const csrfToken = document.cookie.split("; ").find((entry) => entry.startsWith("elitehub_csrf="))?.split("=")[1];
    if (!csrfToken) throw new Error("csrf-cookie");
    const verification = await fetch("/api/v1/auth/email-verification", {
      body: JSON.stringify({ token }),
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": decodeURIComponent(csrfToken) },
      method: "POST",
    });
    status.textContent = verification.ok
      ? "E-mail confirmado. Você já pode voltar à EliteHub Connect."
      : "Este link expirou, já foi usado ou não é válido.";
    history.replaceState({}, document.title, window.location.pathname);
  } catch {
    status.textContent = "Não foi possível confirmar o e-mail agora. Tente novamente.";
  }
}

void confirmarEmail();
