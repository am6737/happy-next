ALTER TABLE "AiAgentTemplate" ADD CONSTRAINT "AiAgentTemplate_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
