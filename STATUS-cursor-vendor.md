# P115: Cursor como vendor nativo (status, JuicySquirrel)

- 22:05 UTC: worktree em ~/.unii/work/JuicySquirrel/uni, branch feat/cursor-vendor de origin/main 7d26a84.
- Sondagem do CLI (v2026.10.22): stream-json tem system/init, user, assistant (delta com timestamp_ms; inteiro sem), thinking delta/completed, tool_call started/completed, result (usage inputTokens/outputTokens/cacheRead/cacheWrite).
- Erros reais: saída "Error: [resource_exhausted] <msg>" e exit 1 (testado com endpoint falso); sem login: "Error: Authentication required..."; modelo inválido: "Cannot use this model".
- O CLI carrega por conta própria ~/.cursor/mcp.json, skills/rules do usuário e plugins de ~/.claude: o bwrap com HOME vazio é necessário.
- 22:00 UTC: o serviço do Cursor passou a travar em "[nal_agent_retries] Initial request" (sem resposta em 240 s). Retestar depois. Implicação: precisa de vigia de silêncio no vendor.
- Próximo: implementar Cursor.ts, Pick/Config/AskAI/Cli, testes.
- 23:20 UTC: Cursor.ts + Pick/Config/AskAI/Cli/Tools/Html/README; Cursor.test.ts (26 testes, CLI falso; bwrap real). bun test 393/0 (base 367); tsc 40 erros = base. Commit 1 a seguir. Próximo: E2E com serve de teste (porta 88xx) e CLI real.
