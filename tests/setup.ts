import "dotenv/config";

process.env.QR_SIGNING_SECRET ??= "test-qr-secret-0123456789abcdef";
process.env.SESSION_SECRET ??= "test-session-secret-0123456789ab";
// Os testes de integração usam uma base de dados própria (nunca a de desenvolvimento).
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
