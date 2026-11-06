 

Aplicação local que:

1. roda a sua consulta SQL no Oracle (uma vez por RA);
2. mostra o JSON gerado em **cascata** (grupos que abrem e mostram os campos, com aviso/erro e a **possível causa**);
3. gera a chave diária, envia o JSON pela API e **marca na cascata os campos** citados no erro devolvido.

 

1. Instale o Node.js 18 ou mais novo.
2. Nesta pasta, rode: `npm install`
3. Copie `.env.example` para `.env` e preencha (Oracle, API da chave, API de envio).
4. Cole a sua consulta em `query.sql` (veja as regras no topo do arquivo).
5. `npm start` e abra http://localhost:3000

 

- Devolver **uma coluna** com o JSON (use `RETURNING CLOB` nas funções `JSON_*`).
- Usar bind variables: `:RA` é preenchido pela tela; qualquer outro (ex.: `:IDHABILITACAOFILIAL`) vira um campo na tela automaticamente.
- Sem `;` no final.

 

- Automática: campos vazios, listas vazias, CPF, datas (AAAA-MM-DD), e-mail, CEP e espaços sobrando.
- Campos obrigatórios: liste em `public/regras.js` (vazio nesses campos vira **erro**, nos demais vira **aviso**).
- Após o envio, as mensagens da API são ligadas aos campos do JSON pelo caminho ou pelo nome do campo citado; o que não for identificado aparece na aba "Retorno da API".

 

A chave fica só na memória do servidor, vale pelo dia e é renovada sozinha se a API responder 401/403.

 

O servidor só escuta em `127.0.0.1` (apenas o seu computador). Não compartilhe o `.env`.
