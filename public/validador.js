 
 
(function (root) {
  const CAUSAS = {
    vazio:
      'A consulta devolveu NULL/vazio para este campo. Confira se o dado está preenchido no cadastro (aluno, curso, instituição) ou se o JOIN/CASE da consulta está trazendo o valor.',
    listaVazia:
      'Nenhum registro foi encontrado pelas condições da consulta (JOIN/filtro, ex.: habilitação, situação da disciplina, período).',
    objetoVazio: 'O bloco foi gerado sem nenhum campo: provavelmente todos os valores vieram NULL no banco.',
    cpf: 'CPF com dígitos verificadores inválidos ou tamanho diferente de 11. Confira o cadastro do aluno (pontuação e zeros à esquerda).',
    data: "Data fora do formato AAAA-MM-DD. Na consulta use TO_CHAR(campo, 'YYYY-MM-DD') e confira se a data não está no futuro/ano absurdo.",
    email: 'E-mail sem o formato usuario@dominio. Confira o cadastro.',
    cep: 'CEP deve ter 8 dígitos (sem pontuação). Confira o endereço do cadastro.',
    espacos: 'Há espaços sobrando no início/fim. Use TRIM() na consulta.',
    textoNulo: 'Veio o texto "null"/"undefined" em vez de vazio. Provavelmente concatenação de campo NULL na consulta.',
    obrigatorio: 'Campo marcado como obrigatório em regras.js e não veio preenchido.',
    ausente: 'Campo obrigatório (regras.js) não existe no JSON gerado. Confira se a consulta o inclui.',
  };

  const CAUSAS_API = [
    [/obrigat|required|n[aã]o (pode|deve) (ser|estar) (nulo|vazio|em branco)|must not be (null|empty|blank)|missing/i, 'Campo obrigatório não preenchido no JSON enviado. Confira o valor na consulta/cadastro.'],
    [/formato|pattern|format|inv[aá]lid|invalid/i, 'Valor em formato diferente do esperado pela API (data, CPF, código, etc.).'],
    [/tamanho|length|maxlength|minlength|excede|muito (longo|curto)|size/i, 'Valor maior ou menor do que o tamanho permitido.'],
    [/duplic|j[aá] (existe|enviad|cadastrad)|already|exist/i, 'Este diploma/registro provavelmente já foi enviado antes.'],
    [/token|unauthori[sz]ed|n[aã]o autorizado|expirad|expired|forbidden|chave/i, 'Chave inválida ou expirada. Gere a chave novamente e reenvie.'],
    [/schema|xsd|estrutura|unexpected|desconhecid|unknown|additional ?propert/i, 'O JSON está fora do schema esperado (campo a mais, a menos ou no lugar errado).'],
    [/n[aã]o encontrad|not found|inexistente/i, 'A API não encontrou um registro de referência (código/curso/IES não cadastrado do lado dela).'],
  ];

  const getRegras = () => (root.REGRAS && Array.isArray(root.REGRAS.obrigatorios) ? root.REGRAS.obrigatorios : []);

  const VAZIOS = ['', 'null', 'undefined', 'nan'];
  const ehVazio = (v) => v === null || v === undefined || (typeof v === 'string' && VAZIOS.includes(v.trim().toLowerCase()));

  function cpfValido(s) {
    const d = String(s).replace(/\D/g, '');
    if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
    for (const t of [9, 10]) {
      let soma = 0;
      for (let i = 0; i < t; i++) soma += Number(d[i]) * (t + 1 - i);
      if (((soma * 10) % 11) % 10 !== Number(d[t])) return false;
    }
    return true;
  }

  function dataValida(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s);
    if (!m) return false;
    const [a, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (a < 1900 || a > 2100) return false;
    const dt = new Date(Date.UTC(a, mo - 1, d));
    return dt.getUTCFullYear() === a && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
  }

  const ehChaveData = (k) => k.startsWith('data') || k.startsWith('dt') || k.endsWith('data') || k.includes('_data') || k.includes('_dt');

  function problema(no, nivel, msg, causa, origem = 'regra') {
    no.problemas.push({ nivel, msg, causa, origem });
  }

 
  const normalizar = (caminho) => caminho.replace(/^\$\.?/, '').replace(/\[\d+\]/g, '[]');

  function casaPadrao(padrao, caminhoNorm) {
    const p = padrao.replace(/^\$\.?/, '');
    const re = new RegExp('^' + p.replace(/[.+?^${}()|\\]/g, '\\$&').replace(/\[\]/g, '\\[\\]').replace(/\*/g, '[^.\\[\\]]*') + '$', 'i');
    return re.test(caminhoNorm);
  }

  const ehObrigatorio = (caminho) => {
    const n = normalizar(caminho);
    return getRegras().some((p) => casaPadrao(p, n));
  };

  function validarFolha(no) {
    const k = String(no.chave).toLowerCase();
    const v = no.valor;
    const obrig = ehObrigatorio(no.caminho);

    if (ehVazio(v)) {
      const txt = typeof v === 'string' && v.trim() !== '' ? CAUSAS.textoNulo : obrig ? CAUSAS.obrigatorio : CAUSAS.vazio;
      problema(no, obrig ? 'erro' : 'aviso', obrig ? 'Campo obrigatório vazio' : 'Campo vazio', txt);
      return;
    }
    if (typeof v === 'string') {
      if (v !== v.trim()) problema(no, 'aviso', 'Espaços no início/fim do texto', CAUSAS.espacos);
      if (k.includes('cpf') && !cpfValido(v)) problema(no, 'erro', 'CPF inválido', CAUSAS.cpf);
      else if (ehChaveData(k) && !dataValida(v.trim())) problema(no, 'erro', 'Data em formato inválido', CAUSAS.data);
      else if (k.includes('email') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())) problema(no, 'erro', 'E-mail inválido', CAUSAS.email);
      else if ((k === 'cep' || k.endsWith('cep')) && v.replace(/\D/g, '').length !== 8) problema(no, 'erro', 'CEP inválido', CAUSAS.cep);
    }
  }

  function construir(valor, chave, caminho) {
    const no = { chave, caminho, problemas: [], filhos: [], tipo: 'valor', valor, erros: 0, avisos: 0 };
    if (Array.isArray(valor)) {
      no.tipo = 'lista';
      valor.forEach((v, i) => no.filhos.push(construir(v, String(i), `${caminho}[${i}]`)));
      if (!valor.length) {
        const o = ehObrigatorio(caminho);
        problema(no, o ? 'erro' : 'aviso', 'Lista vazia', o ? CAUSAS.obrigatorio : CAUSAS.listaVazia);
      }
    } else if (valor && typeof valor === 'object') {
      no.tipo = 'objeto';
      const chaves = Object.keys(valor);
      chaves.forEach((c) => no.filhos.push(construir(valor[c], c, `${caminho}.${c}`)));
      if (!chaves.length) problema(no, 'aviso', 'Bloco sem campos', CAUSAS.objetoVazio);
    } else {
      validarFolha(no);
    }
    return no;
  }

  function contar(no) {
    let e = no.problemas.filter((p) => p.nivel === 'erro').length;
    let a = no.problemas.filter((p) => p.nivel === 'aviso').length;
    for (const f of no.filhos) {
      const c = contar(f);
      e += c.erros;
      a += c.avisos;
    }
    no.erros = e;
    no.avisos = a;
    return { erros: e, avisos: a };
  }

  function localizar(raiz, caminhos) {
    const achados = new Set(caminhos.map(normalizar));
    const existe = (no) => {
      if (achados.has(normalizar(no.caminho))) achados.delete(normalizar(no.caminho));
      no.filhos.forEach(existe);
    };
    existe(raiz);
    return [...achados];
  }

  function ausentes(raiz) {
    const faltando = [];
    for (const p of getRegras()) {
      if (/[*]|\[\]/.test(p)) continue; // só verifica caminhos exatos
      const partes = p.replace(/^\$\.?/, '').split('.');
      let no = raiz;
      for (const parte of partes) {
        const f = no.filhos.find((x) => String(x.chave).toLowerCase() === parte.toLowerCase());
        if (!f) {
          problema(no, 'erro', `Campo obrigatório ausente: ${parte}`, CAUSAS.ausente);
          faltando.push(p);
          break;
        }
        no = f;
      }
    }
    return faltando;
  }

  function validar(json) {
    const raiz = construir(json, 'JSON', '$');
    ausentes(raiz);
    contar(raiz);
    return raiz;
  }

  function limparApi(no) {
    no.problemas = no.problemas.filter((p) => p.origem !== 'api');
    no.filhos.forEach(limparApi);
  }

 
  const CHAVES_CAMPO = ['campo', 'field', 'path', 'property', 'propertyPath', 'pointer', 'instancePath', 'atributo'];
  const CHAVES_MSG = ['mensagem', 'message', 'erro', 'error', 'detail', 'detalhe', 'descricao', 'description', 'motivo', 'msg'];
  const IGNORAR = ['timestamp', 'status', 'code', 'codigo', 'trace', 'stack', 'traceid', 'requestid'];

  function coletar(x, acc) {
    if (typeof x === 'string') {
      if (x.trim().length > 3 && !/^\d{4}-\d{2}-\d{2}/.test(x)) acc.push({ msg: x.trim() });
    } else if (Array.isArray(x)) {
      x.forEach((i) => coletar(i, acc));
    } else if (x && typeof x === 'object') {
      const chMsg = CHAVES_MSG.find((k) => typeof x[k] === 'string');
      const chCampo = CHAVES_CAMPO.find((k) => typeof x[k] === 'string');
      if (chMsg) acc.push({ msg: x[chMsg].trim(), campo: chCampo ? x[chCampo] : undefined });
      for (const k of Object.keys(x)) {
        if (k === chMsg || k === chCampo || IGNORAR.includes(k.toLowerCase())) continue;
        coletar(x[k], acc);
      }
    }
    return acc;
  }

  const tokenizar = (s) =>
    s
      .toLowerCase()
      .split(/[^a-z0-9_áéíóúâêôãõç]+/)
      .map((t) => t.replace(/_/g, ''))
      .filter(Boolean);

  function todosNos(no, lista = []) {
    lista.push(no);
    no.filhos.forEach((f) => todosNos(f, lista));
    return lista;
  }

  function causaApi(msg) {
    const c = CAUSAS_API.find(([re]) => re.test(msg));
    return c ? c[1] : 'Erro devolvido pela API. Confira o campo indicado e o valor gerado pela consulta.';
  }

  function aplicarRetornoApi(raiz, corpo) {
    limparApi(raiz);
    const nos = todosNos(raiz).filter((n) => n.caminho !== '$');
    const semCampo = [];
    const msgs = coletar(corpo, []);
    let aplicados = 0;

    for (const { msg, campo } of msgs) {
      const causa = causaApi(msg);
      let alvos = [];

 
      const candidatos = [];
      if (campo) candidatos.push(campo);
      for (const m of msg.matchAll(/[A-Za-z_][\w]*(?:(?:\.|\/)[A-Za-z_\[\]\d][\w\[\]]*)+/g)) candidatos.push(m[0]);
      for (const c of candidatos) {
        const alvo = c.replace(/^\$\.?/, '').replace(/^\//, '').replace(/\//g, '.').replace(/\[\d+\]|\.\d+(?=\.|$)/g, '[]').toLowerCase();
        const achou = nos.filter((n) => {
          const np = normalizar(n.caminho).toLowerCase();
          return np === alvo || np.endsWith('.' + alvo) || alvo.endsWith(np);
        });
        if (achou.length) {
          alvos = achou;
          break;
        }
      }

 
      if (!alvos.length) {
        const tokens = new Set(tokenizar(msg));
        const achou = nos.filter((n) => n.tipo === 'valor' && String(n.chave).length >= 3 && tokens.has(String(n.chave).toLowerCase().replace(/_/g, '')));
        if (achou.length && achou.length <= 3) alvos = achou;
      }

      if (alvos.length) {
        alvos.forEach((n) => problema(n, 'erro', msg, causa, 'api'));
        aplicados += 1;
      } else {
        semCampo.push({ msg, causa });
      }
    }
    contar(raiz);
    return { semCampo, aplicados };
  }

  const api = { validar, aplicarRetornoApi, contar, todosNos, ehVazio, cpfValido, dataValida };
  root.Validador = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
