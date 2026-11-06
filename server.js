require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const oracledb = require('oracledb');

oracledb.fetchAsString = [oracledb.CLOB];
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

if (process.env.ORACLE_CLIENT_LIB_DIR) {
  oracledb.initOracleClient({ libDir: process.env.ORACLE_CLIENT_LIB_DIR });
}

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(
  express.static(path.join(__dirname, 'public'), {
    etag: false,
    lastModified: false,
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
  })
);

const SQL_FILE = path.join(__dirname, 'query.sql');

 
const env = (k, d = '') => process.env[k] ?? d;

function jsonEnv(k, padrao = {}) {
  const v = env(k);
  if (!v) return padrao;
  try {
    return JSON.parse(v);
  } catch {
    throw new Error(`${k} no .env não é um JSON válido`);
  }
}

const getPath = (obj, caminho) =>
  caminho.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

const hoje = () => new Date().toLocaleDateString('sv-SE'); // AAAA-MM-DD no fuso local

function lerSql() {
  return fs.readFileSync(SQL_FILE, 'utf8').trim().replace(/[;\s]+$/, '');
}

function nomesDeBinds(sql) {
  const limpo = sql
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'(?:[^']|'')*'/g, "''");
  const nomes = new Set();
  for (const m of limpo.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)) nomes.add(m[1]);
  return [...nomes];
}

const DICAS_ORACLE = [
  [/ORA-01017/, 'Usuário ou senha do Oracle inválidos (confira ORACLE_USER / ORACLE_PASSWORD no .env).'],
  [/ORA-12154|ORA-12514|ORA-12541|ORA-12170|NJS-503|NJS-515/, 'Não foi possível conectar ao banco: confira ORACLE_CONNECT_STRING, VPN/rede e se o serviço está no ar.'],
  [/ORA-00942/, 'Tabela ou view não existe para este usuário (nome errado ou falta de permissão).'],
  [/ORA-00904/, 'Coluna inexistente na consulta (nome errado ou coluna de outra tabela).'],
  [/ORA-01722/, 'Valor não numérico sendo comparado/convertido como número (ex.: RA ou ID com letras).'],
  [/ORA-01489|ORA-40478|ORA-40459/, 'O JSON excedeu o limite de texto: use RETURNING CLOB nas funções JSON_OBJECT/JSON_ARRAYAGG.'],
  [/ORA-01008/, 'Há uma bind variable na consulta sem valor informado.'],
  [/ORA-01427/, 'Uma subconsulta retornou mais de uma linha onde só cabia uma (verifique duplicidades no cadastro).'],
  [/NJS-116|DPY-3010|DPI-1047/, 'Versão do Oracle exige o "modo thick": instale o Oracle Instant Client e informe ORACLE_CLIENT_LIB_DIR no .env.'],
];

function dica(msg) {
  const d = DICAS_ORACLE.find(([re]) => re.test(msg));
  return d ? d[1] : null;
}

async function abrirConexao() {
  return oracledb.getConnection({
    user: env('ORACLE_USER'),
    password: env('ORACLE_PASSWORD'),
    connectString: env('ORACLE_CONNECT_STRING'),
  });
}

 
let cacheChave = { token: null, dia: null };

async function chamar(url, method, headers, body) {
  const r = await fetch(url, {
    method,
    headers,
    body: method === 'GET' ? undefined : body,
    signal: AbortSignal.timeout(60000),
  });
  const texto = await r.text();
  let corpo;
  try {
    corpo = JSON.parse(texto);
  } catch {
    corpo = texto;
  }
  return { status: r.status, ok: r.ok, corpo };
}

async function obterChave(forcar = false) {
  if (!forcar && cacheChave.token && cacheChave.dia === hoje()) return cacheChave.token;

  const url = env('AUTH_URL');
  if (!url) throw new Error('AUTH_URL não está configurada no .env');

  const headers = { 'Content-Type': 'application/json', ...jsonEnv('AUTH_HEADERS') };
  const r = await chamar(url, env('AUTH_METHOD', 'POST').toUpperCase(), headers, env('AUTH_BODY') || undefined);

  if (!r.ok) {
    const e = new Error(`A API de chave respondeu HTTP ${r.status}`);
    e.detalhe = r.corpo;
    throw e;
  }

  const campo = env('AUTH_TOKEN_PATH', 'token');
  const token = typeof r.corpo === 'object' ? getPath(r.corpo, campo) : String(r.corpo).trim();
  if (!token) {
    const e = new Error(`Não encontrei a chave no campo "${campo}" da resposta (ajuste AUTH_TOKEN_PATH).`);
    e.detalhe = r.corpo;
    throw e;
  }

  cacheChave = { token: String(token), dia: hoje() };
  return cacheChave.token;
}

 
app.get('/api/status', (req, res) => {
  res.json({
    configurado: {
      oracle: !!(env('ORACLE_USER') && env('ORACLE_CONNECT_STRING')),
      chave: !!env('AUTH_URL'),
      envio: !!env('SEND_URL'),
    },
    chaveDeHoje: cacheChave.token && cacheChave.dia === hoje(),
  });
});

app.get('/api/parametros', (req, res) => {
  try {
    const binds = nomesDeBinds(lerSql());
    res.json({ binds });
  } catch (e) {
    res.status(500).json({ erro: `Não consegui ler o query.sql: ${e.message}` });
  }
});

app.post('/api/chave', async (req, res) => {
  try {
    await obterChave(true);
    res.json({ ok: true, chaveDeHoje: true });
  } catch (e) {
    res.status(502).json({ ok: false, erro: e.message, detalhe: e.detalhe });
  }
});

 
function expandirListas(sql, valores) {
  const binds = {};
  let sqlFinal = sql;
  for (const [nome, v] of Object.entries(valores)) {
    if (!Array.isArray(v)) {
      binds[nome] = v;
      continue;
    }
    const nomes = v.map((_, i) => `${nome}_${i}`);
    const re = new RegExp(`:${nome}(?![A-Za-z0-9_])`, 'gi');
    sqlFinal = sqlFinal.replace(re, nomes.map((n) => `:${n}`).join(', '));
    v.forEach((item, i) => (binds[nomes[i]] = item));
  }
  return { sqlFinal, binds };
}

 
function linhasParaResultados(linhas, ra) {
  const colunas = Object.keys(linhas[0]);
  if (colunas.length === 1) {
    return linhas.map((l) => {
      const d = l[colunas[0]];
      try {
        return { ra, json: typeof d === 'string' ? JSON.parse(d) : d };
      } catch (e) {
        const inicio = String(d ?? '');
        return {
          ra,
          erro: `A coluna retornada não é um JSON válido (${e.message}).`,
          causa: inicio ? `Início do conteúdo: ${inicio.slice(0, 200)}` : 'A coluna veio vazia (NULL).',
        };
      }
    });
  }
  return linhas.map((l) => ({ ra, json: l }));
}

app.post('/api/consultar', async (req, res) => {
  const { ras = [], parametros = {} } = req.body || {};

  let sql;
  try {
    sql = lerSql();
  } catch (e) {
    return res.status(500).json({ erro: `Não consegui ler o query.sql: ${e.message}` });
  }

  const nomes = nomesDeBinds(sql);
  const usaRa = nomes.some((n) => n.toUpperCase() === 'RA');

  if (usaRa && (!Array.isArray(ras) || !ras.length)) {
    return res.status(400).json({ erro: 'Informe ao menos um RA.' });
  }

 
  const valores = {};
  for (const [k, v] of Object.entries(parametros)) {
    const chave = k.toUpperCase();
    if (/LISTA/i.test(chave) || Array.isArray(v)) {
      const itens = (Array.isArray(v) ? v : String(v ?? '').split(/[\s,;]+/))
        .map((x) => String(x).replace(/['"]/g, '').trim())
        .filter(Boolean);
      valores[chave] = [...new Set(itens)];
    } else {
      valores[chave] = v;
    }
  }

  let conn;
  try {
    conn = await abrirConexao();
  } catch (e) {
    return res.status(502).json({ erro: e.message, dica: dica(e.message) });
  }

 
  const executar = async (vals, ra) => {
    const faltando = [];
    const usados = {};
    for (const nome of nomes) {
      const v = vals[nome.toUpperCase()];
      if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) faltando.push(nome);
      else usados[nome] = v;
    }
    if (faltando.length) return [{ ra, erro: `Parâmetro(s) sem valor: ${faltando.join(', ')}` }];

    const grandes = Object.entries(usados).find(([, v]) => Array.isArray(v) && v.length > 1000);
    if (grandes) return [{ ra, erro: `A lista :${grandes[0]} tem mais de 1000 itens (limite do Oracle para IN).` }];

    const { sqlFinal, binds } = expandirListas(sql, usados);
    try {
      const r = await conn.execute(sqlFinal, binds);
      const linhas = r.rows || [];
      if (!linhas.length) {
        return [
          {
            ra,
            erro: 'A consulta não retornou nenhuma linha.',
            causa: 'RA inexistente ou filtros (habilitação/filial/lote/situação) não encontraram o aluno.',
          },
        ];
      }
      return linhasParaResultados(linhas, ra);
    } catch (e) {
      return [{ ra, erro: e.message, causa: dica(e.message) }];
    }
  };

  const resultados = [];
  try {
    if (usaRa) {
 
      for (const ra of ras) {
        const r = await executar({ ...valores, RA: ra }, ra);
 
        if (r.length > 1 && r.every((x) => x.json !== undefined)) resultados.push({ ra, json: r.map((x) => x.json) });
        else resultados.push(...r);
      }
    } else {
 
      resultados.push(...(await executar(valores, undefined)));
    }
    res.json({ resultados });
  } finally {
    try {
      await conn.close();
    } catch {
      /* ignora */
    }
  }
});

app.post('/api/enviar', async (req, res) => {
  const { json } = req.body || {};
  if (json === undefined) return res.status(400).json({ erro: 'Nenhum JSON recebido para envio.' });

  const url = env('SEND_URL');
  if (!url) return res.status(500).json({ erro: 'SEND_URL não está configurada no .env' });

  const tentar = async (forcar) => {
    const token = await obterChave(forcar);
    const modelo = jsonEnv('SEND_HEADERS', {
      'Content-Type': 'application/json',
      Authorization: 'Bearer {token}',
    });
    const headers = {};
    for (const [k, v] of Object.entries(modelo)) headers[k] = String(v).replace('{token}', token);
    return chamar(url, env('SEND_METHOD', 'POST').toUpperCase(), headers, JSON.stringify(json));
  };

  try {
    let r = await tentar(false);
    let renovada = false;
    if (r.status === 401 || r.status === 403) {
      r = await tentar(true); // chave pode ter expirado: renova e tenta de novo
      renovada = true;
    }
    res.json({ ...r, chaveRenovada: renovada });
  } catch (e) {
    res.status(502).json({ erro: e.message, detalhe: e.detalhe });
  }
});

const porta = Number(env('PORT', '3000'));
app.listen(porta, '127.0.0.1', () => {
  console.log(`Diploma Digital rodando em http://localhost:${porta}`);
});