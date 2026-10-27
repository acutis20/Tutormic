# 🎙️ TutorMic

Transforma o celular, o notebook ou o PC da faculdade no microfone da aula. O som sai na caixa de som (JBL via Bluetooth ou cabo) e a aula é gravada, transcrita e revisada por IA.

- **Microfone ao vivo**: usa o mic do aparelho ou um mic externo (por exemplo, fone com fio preso perto da boca, como lapela). Tem botão grande de mudo, controle de volume, limitador e detecção automática de microfonia, que abaixa o volume quando a caixa começa a apitar.
- **Gravação segura**: o áudio é gravado em partes de 5 min, salvas primeiro no aparelho e depois enviadas para a nuvem. Se a internet cair, nada se perde.
- **Transcrição e revisão**: o Whisper transcreve e o Claude gera um texto limpo e corrigido para os alunos e um feedback **privado** para a professora.
- **Privacidade**: correções e feedback só aparecem se a professora ativar "Mostrar correções e feedback", e nunca são enviados aos alunos. Só o texto que ela aprovar é publicado, e isso é garantido por regras de acesso (RLS) no banco.

## Stack

PWA com React, TypeScript e Vite · Supabase (Auth, Postgres/RLS, Storage, Edge Functions) · OpenAI Whisper · Claude API

## Como rodar

### 1. Supabase

1. Crie um projeto em [supabase.com](https://supabase.com).
2. Aplique a migration: `supabase db push` ou cole `supabase/migrations/0001_init.sql` no SQL Editor.
3. Configure os secrets das funções:
   ```bash
   supabase secrets set OPENAI_API_KEY=... ANTHROPIC_API_KEY=...
   ```
4. Publique as funções:
   ```bash
   supabase functions deploy transcribe-lesson
   supabase functions deploy review-lesson
   ```

### 2. App

```bash
cp .env.example .env.local   # preencha a URL e a anon key do projeto
npm install
npm run dev
```

Para usar no celular, publique o build (`npm run build` gera `dist/`) em qualquer hospedagem com HTTPS, como Vercel ou Netlify. O navegador só libera o microfone em HTTPS. Depois, no celular, use "Adicionar à tela inicial".

## Como usar na aula

1. Pareie a JBL no Bluetooth do aparelho (ou ligue pelo cabo P2).
2. Abra o app, crie a aula e toque em **Ligar microfone e gravar**.
3. Se for usar um fone com fio, plugue e escolha o microfone dele. O app também sugere a troca sozinho quando detecta um fone novo.
4. Ao final, toque em **Encerrar aula**. A transcrição e a revisão começam automaticamente.
5. Revise o texto, aceite ou rejeite as sugestões (se quiser vê-las) e toque em **Aprovar e publicar**.

> O Bluetooth adiciona de 0,15 a 0,3 s de atraso. Para a fala na sala isso costuma ser aceitável, mas pelo cabo o atraso é praticamente zero.

## Desenvolvimento

```bash
npm test        # testes unitários (vitest)
npm run build   # typecheck + build
```

## Próximos passos

Área dos alunos (turmas com convite por código, aulas publicadas com áudio e slides), upload de slides e sincronização dos slides com a transcrição.
