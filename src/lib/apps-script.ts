/** Código do Google Apps Script que envia os emails do Horbit pelo Gmail da empresa-mãe (sem SMTP). */
export function appsScriptCode(secret: string) {
  return `/**
 * Horbit — envio de emails pelo Gmail (Google Apps Script).
 * Não usa SMTP: é o Gmail desta conta que envia as credenciais e os avisos do Horbit.
 * Não altere o SEGREDO: tem de ser igual ao que aparece no Horbit (Plataforma > Emails).
 */
var SEGREDO = "${secret}";

function doPost(e) {
  try {
    var p = JSON.parse(e.postData.contents);
    if (p.secret !== SEGREDO) return resposta({ ok: false, error: "Segredo errado: copie de novo o código que está no Horbit." });
    if (p.ping) return resposta({ ok: true, quota: MailApp.getRemainingDailyQuota() });
    var para = [].concat(p.to || []).join(",");
    if (!para) return resposta({ ok: false, error: "Sem destinatário." });
    var opcoes = { name: p.fromName || "Horbit" };
    if (p.html) opcoes.htmlBody = p.html;
    if (p.replyTo) opcoes.replyTo = p.replyTo;
    MailApp.sendEmail(para, p.subject || "Horbit", p.text || "", opcoes);
    return resposta({ ok: true, quota: MailApp.getRemainingDailyQuota() });
  } catch (err) {
    return resposta({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function doGet() {
  return resposta({ ok: true, servico: "Horbit email" });
}

function resposta(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/** Carregue em Executar com esta função escolhida, uma vez, para autorizar o envio pelo Gmail. */
function autorizar() {
  Logger.log("Emails que ainda pode enviar hoje: " + MailApp.getRemainingDailyQuota());
}
`;
}
