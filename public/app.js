(function () {
  const $ = (id) => document.getElementById(id);
  const V = window.Validador;

  const estado = {
    resultados: [], // { id, ra, json, raiz, erro, causa, envio, semCampo }
    selecionado: null,
    aba: 'arvore',
    contadorManual: 0,
    usaRa: true, // false quando a consulta não tem :RA (ex.: só :LISTA_RA)
  };

 
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function toast(msg, ms = 4000) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (t.hidden = true), ms);
  }

  async function api(url, corpo) {
    const r = await fetch(url, {
      method: corpo === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    let dados;
    try {
      dados = await r.json();
    } catch {
      dados = { erro: `Resposta inválida do servidor (HTTP ${r.status})` };
    }
    return { ok: r.ok, status: r.status, dados };
  }

  function salvarLocal(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignora */
    }
  }
  function lerLocal(k) {
    try {
      return localStorage.getItem(k) || '';
    } catch {
      return '';
    }
  }

  function acharNome(no) {
 
    const diplomados = [];
    for (const n of V.todosNos(no)) {
      if (n.tipo === 'valor' && String(n.chave).toLowerCase() === 'nomediplomado' && typeof n.valor === 'string' && n.valor.trim()) diplomados.push(n.valor.trim());
    }
    if (diplomados.length) return [...new Set(diplomados)].join(' / ');
    for (const n of V.todosNos(no)) {
      if (n.tipo === 'valor' && String(n.chave).toLowerCase() === 'nome' && typeof n.valor === 'string' && n.valor.trim()) return n.valor;
    }
    return '';
  }

  function acharRa(no) {
    const chaves = ['ra', 'registroacademico', 'matricula', 'codigoaluno'];
    for (const n of V.todosNos(no)) {
      const k = String(n.chave).toLowerCase();
      if (n.tipo === 'valor' && (chaves.includes(k) || /(^|_)ra($|_)/.test(k)) && !V.ehVazio(n.valor)) return String(n.valor);
    }
    return '';
  }

 
  async function carregarStatus() {
    const { dados } = await api('/api/status');
    const chip = $('chipChave');
    if (dados.chaveDeHoje) {
      chip.textContent = 'Chave de hoje: ok';
      chip.className = 'chip ok';
    } else {
      chip.textContent = 'Chave de hoje: ainda não gerada';
      chip.className = 'chip';
    }
    const faltando = [];
    if (dados.configurado) {
      if (!dados.configurado.oracle) faltando.push('Oracle (ORACLE_USER / ORACLE_CONNECT_STRING)');
      if (!dados.configurado.chave) faltando.push('API da chave (AUTH_URL)');
      if (!dados.configurado.envio) faltando.push('API de envio (SEND_URL)');
    }
    const faixa = $('avisoConfig');
    if (faltando.length) {
      faixa.hidden = false;
      faixa.textContent = `Falta configurar no arquivo .env: ${faltando.join('; ')}.`;
    } else {
      faixa.hidden = true;
    }
  }

  $('btnChave').addEventListener('click', async () => {
    const b = $('btnChave');
    b.disabled = true;
    const { ok, dados } = await api('/api/chave', {});
    b.disabled = false;
    if (ok) toast('Chave gerada com sucesso.');
    else toast(`Não consegui gerar a chave: ${dados.erro || 'erro desconhecido'}${dados.detalhe ? ' — ' + JSON.stringify(dados.detalhe).slice(0, 200) : ''}`, 8000);
    carregarStatus();
  });

 
 
 
  const ROTULOS = {
    LISTA_RA: 'RAs dos alunos',
    IDHABILITACAOFILIAL: 'Habilitação / Filial',
    LOTE: 'Lote',
  };

  async function carregarParametros() {
    const { ok, dados } = await api('/api/parametros');
    const div = $('params');
    div.innerHTML = '';
    if (!ok) {
      div.innerHTML = `<p class="vazio">${esc(dados.erro || 'Não consegui ler o query.sql')}</p>`;
      return;
    }
    estado.usaRa = (dados.binds || []).some((b) => b.toUpperCase() === 'RA');
    $('blocoRas').hidden = !estado.usaRa;
    (dados.binds || [])
      .filter((b) => b.toUpperCase() !== 'RA')
      .forEach((b) => {
        const id = `param_${b}`;
        const l = document.createElement('label');
        l.htmlFor = id;
        l.textContent = ROTULOS[b.toUpperCase()] || `:${b}`;
        const lista = /lista/i.test(b);
        const i = document.createElement(lista ? 'textarea' : 'input');
        if (lista) {
          i.rows = 4;
          i.placeholder = 'Um ou mais RAs, separados por vírgula, espaço ou Enter (sem aspas)';
        }
        i.id = id;
        i.dataset.bind = b;
        i.value = lerLocal(`param_${b}`);
        i.addEventListener('input', () => salvarLocal(`param_${b}`, i.value));
        div.append(l, i);
      });
  }

 
  function adicionarResultado(r, idx = 0) {
    const item = { id: `r${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${idx}`, ra: r.ra, envio: null, semCampo: [] };
    if (r.json !== undefined) {
      item.json = r.json;
      item.raiz = V.validar(r.json);
      item.nome = acharNome(item.raiz);
      if (!item.ra) item.ra = acharRa(item.raiz) || `Registro ${idx + 1}`;
    } else {
      item.erro = r.erro;
      item.causa = r.causa;
      if (!item.ra) item.ra = `Registro ${idx + 1}`;
    }
    return item;
  }

 
 
  function separarDiplomas(resultados) {
    const saida = [];
    for (const r of resultados) {
      const j = r.json;
      const chave = j && typeof j === 'object' && !Array.isArray(j) ? Object.keys(j).find((k) => k.toLowerCase() === 'diplomas') : null;
      if (chave && Array.isArray(j[chave]) && j[chave].length > 1) {
        j[chave].forEach((d) => saida.push({ ...r, ra: undefined, json: { ...j, [chave]: [d] } }));
      } else {
        saida.push(r);
      }
    }
    return saida;
  }

  $('btnConsultar').addEventListener('click', async () => {
    const ras = estado.usaRa ? [...new Set($('ras').value.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))] : [];
    if (estado.usaRa && !ras.length) return toast('Informe ao menos um RA.');
    if (estado.usaRa) salvarLocal('ras', $('ras').value);

    const parametros = {};
    let listaVazia = null;
    document.querySelectorAll('#params input, #params textarea').forEach((el) => {
      const bind = el.dataset.bind;
      const v = el.value.trim();
      if (/lista/i.test(bind)) {
 
        const itens = [...new Set(v.split(/[\s,;]+/).map((x) => x.replace(/['"]/g, '').trim()).filter(Boolean))];
        if (!itens.length) listaVazia = bind;
        parametros[bind] = itens; // array: o servidor expande em :BIND_0, :BIND_1...
      } else {
        parametros[bind] = v;
      }
    });
    if (listaVazia) return toast(`Informe ao menos um valor em :${listaVazia}.`);

    const b = $('btnConsultar');
    b.disabled = true;
    b.textContent = 'Consultando…';
    const { ok, dados } = await api('/api/consultar', { ras, parametros });
    b.disabled = false;
    b.textContent = 'Consultar no Oracle';

    if (!ok) {
      estado.resultados = [];
      estado.selecionado = null;
      renderLista();
      $('detalhe').innerHTML = `<div class="erro-bloco"><strong>${esc(dados.erro || 'Falha na consulta')}</strong>${dados.dica ? `<span class="causa">Possível causa: ${esc(dados.dica)}</span>` : ''}</div>`;
      return;
    }

    estado.resultados = separarDiplomas(dados.resultados).map((r, i) => adicionarResultado(r, i));
    estado.selecionado = estado.resultados.length ? estado.resultados[0].id : null;
    estado.aba = 'arvore';
    renderLista();
    renderDetalhe();
  });

 
  $('btnColar').addEventListener('click', () => $('dlgColar').showModal());
  $('btnConfirmaColar').addEventListener('click', () => {
    const texto = $('txtColar').value.trim();
    if (!texto) return;
    let json;
    try {
      json = JSON.parse(texto);
    } catch (e) {
      toast(`JSON inválido: ${e.message}`, 8000);
      return;
    }
    estado.contadorManual += 1;
    const item = adicionarResultado({ ra: `manual-${estado.contadorManual}`, json });
    estado.resultados.unshift(item);
    estado.selecionado = item.id;
    estado.aba = 'arvore';
    $('txtColar').value = '';
    renderLista();
    renderDetalhe();
  });

 
  function seloStatus(r) {
    if (r.erro) return '<span class="selo erro">✖ falha</span>';
    if (r.envio) {
      if (r.envio.ok) return '<span class="selo ok">✔ enviado</span>';
      return '<span class="selo erro">✖ rejeitado</span>';
    }
    if (r.raiz.erros) return `<span class="selo erro">✖ ${r.raiz.erros}</span>`;
    if (r.raiz.avisos) return `<span class="selo aviso">⚠ ${r.raiz.avisos}</span>`;
    return '<span class="selo ok">✓ ok</span>';
  }

  function renderLista() {
    const ul = $('lista');
    ul.innerHTML = '';
    $('listaVazia').hidden = estado.resultados.length > 0;
    $('contAlunos').textContent = estado.resultados.length ? `(${estado.resultados.length})` : '';
    $('btnEnviarTodos').hidden = estado.resultados.length < 2;
    if (!$('btnEnviarTodos').disabled) $('btnEnviarTodos').textContent = 'Enviar todos juntos (mesmo lote)';

    estado.resultados.forEach((r) => {
      const li = document.createElement('li');
      li.className = 'item' + (r.id === estado.selecionado ? ' ativo' : '');
      li.tabIndex = 0;
      li.innerHTML = `<span class="quem"><span class="ra">${esc(r.ra)}</span>${r.nome ? `<span class="nome">${esc(r.nome)}</span>` : ''}</span>${seloStatus(r)}`;
      const abrir = () => {
        estado.selecionado = r.id;
        estado.aba = 'arvore';
        renderLista();
        renderDetalhe();
      };
      li.addEventListener('click', abrir);
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          abrir();
        }
      });
      ul.append(li);
    });
  }

 
  function rotulo(no, pai) {
    if (pai && pai.tipo === 'lista') {
      let extra = '';
      if (no.tipo === 'objeto') {
        const pref = ['nome', 'descricao', 'disciplina', 'nomedisciplina', 'codigo', 'ra'];
        for (const p of pref) {
          const f = no.filhos.find((x) => String(x.chave).toLowerCase() === p && x.tipo === 'valor' && x.valor);
          if (f) {
            extra = ` — ${String(f.valor).slice(0, 60)}`;
            break;
          }
        }
      }
      return `#${Number(no.chave) + 1}${extra}`;
    }
    return no.chave;
  }

  function badges(no) {
    let h = '';
    if (no.erros) h += `<span class="selo erro">✖ ${no.erros}</span>`;
    if (no.avisos) h += `<span class="selo aviso">⚠ ${no.avisos}</span>`;
    if (!no.erros && !no.avisos) h += '<span class="selo ok">✓</span>';
    return h;
  }

  function htmlProblemas(no) {
    return no.problemas
      .map(
        (p) =>
          `<div class="problema ${p.nivel}"><strong>${esc(p.msg)}</strong>${p.origem === 'api' ? '<span class="origem">retorno da API</span>' : ''}<span class="causa">Possível causa: ${esc(p.causa)}</span></div>`
      )
      .join('');
  }

  function formatarValor(v) {
    if (V.ehVazio(v)) return `<em>${v === null || v === undefined ? 'vazio (NULL)' : v === '' ? 'vazio ("")' : esc(v)}</em>`;
    const s = String(v);
    return esc(s.length > 240 ? s.slice(0, 240) + '…' : s);
  }

  function htmlNo(no, pai, aberto) {
    const rot = esc(rotulo(no, pai));
    if (no.tipo === 'valor') {
      const temErro = no.problemas.some((p) => p.nivel === 'erro');
      const sev = temErro ? 'sev-erro' : no.problemas.length ? 'sev-aviso' : '';
      const icone = temErro ? '✖' : no.problemas.length ? '⚠' : '✓';
      return `<div class="folha ${sev}"><div class="folha-linha"><span class="icone">${icone}</span><span class="chave">${rot}</span><span class="valor">${formatarValor(no.valor)}</span></div>${htmlProblemas(no)}</div>`;
    }
    const tipo = no.tipo === 'lista' ? `lista · ${no.filhos.length} ${no.filhos.length === 1 ? 'item' : 'itens'}` : 'grupo';
    const cls = (no.erros ? 'tem-erro ' : '') + (no.avisos ? 'tem-aviso' : '');
    const filhos = no.filhos.map((f) => htmlNo(f, no, false)).join('');
    return `<details class="${cls}" ${aberto ? 'open' : ''}><summary><span class="chave">${rot}</span><span class="tipo">${tipo}</span><span class="badges">${badges(no)}</span></summary><div class="conteudo">${htmlProblemas(no)}${filhos}</div></details>`;
  }

 
  function atual() {
    return estado.resultados.find((r) => r.id === estado.selecionado);
  }

  function renderDetalhe() {
    const r = atual();
    const el = $('detalhe');
    if (!r) {
      el.innerHTML = '<div class="placeholder"><h2>Nada selecionado</h2><p>Consulte um ou mais RAs, ou cole um JSON, para validar aqui.</p></div>';
      return;
    }

    if (r.erro) {
      el.innerHTML = `<div class="detalhe-topo"><div><h2>RA ${esc(r.ra)}</h2></div></div><div class="erro-bloco"><strong>${esc(r.erro)}</strong>${r.causa ? `<span class="causa">Possível causa: ${esc(r.causa)}</span>` : ''}</div>`;
      return;
    }

    const resumo = `${r.raiz.erros ? `<span class="selo erro">✖ ${r.raiz.erros} erro(s)</span>` : ''}${r.raiz.avisos ? `<span class="selo aviso">⚠ ${r.raiz.avisos} aviso(s)</span>` : ''}${!r.raiz.erros && !r.raiz.avisos ? '<span class="selo ok">✓ nenhum problema encontrado</span>' : ''}${r.envio ? (r.envio.ok ? '<span class="selo ok">✔ enviado</span>' : '<span class="selo erro">✖ rejeitado pela API</span>') : ''}`;

    el.innerHTML = `
      <div class="detalhe-topo">
        <div>
          <h2>RA ${esc(r.ra)}${r.nome ? ` — ${esc(r.nome)}` : ''}</h2>
          <div class="resumo">${resumo}</div>
        </div>
        <div class="acoes">
          <button id="btnCopiar" class="secundario pequeno">Copiar JSON</button>
          <button id="btnBaixar" class="secundario pequeno">Baixar JSON</button>
          <button id="btnEnviar" class="primario pequeno">Enviar para a API</button>
        </div>
      </div>
      <div class="abas" role="tablist">
        <button class="aba ${estado.aba === 'arvore' ? 'ativa' : ''}" data-aba="arvore" role="tab">Cascata</button>
        <button class="aba ${estado.aba === 'json' ? 'ativa' : ''}" data-aba="json" role="tab">JSON</button>
        <button class="aba ${estado.aba === 'api' ? 'ativa' : ''}" data-aba="api" role="tab">Retorno da API${r.envio ? (r.envio.ok ? ' ✔' : ' ✖') : ''}</button>
      </div>
      <div id="conteudoAba"></div>`;

    el.querySelectorAll('.aba').forEach((b) =>
      b.addEventListener('click', () => {
        estado.aba = b.dataset.aba;
        renderDetalhe();
      })
    );
    $('btnCopiar').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify(r.json, null, 2));
        toast('JSON copiado.');
      } catch {
        toast('Não consegui copiar; use a aba JSON e copie manualmente.');
      }
    });
    $('btnBaixar').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(r.json, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `diploma-${r.ra}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
    $('btnEnviar').addEventListener('click', () => enviar(r, $('btnEnviar')));

    const c = $('conteudoAba');
    if (estado.aba === 'json') {
      c.innerHTML = `<pre class="json">${esc(JSON.stringify(r.json, null, 2))}</pre>`;
    } else if (estado.aba === 'api') {
      c.innerHTML = htmlRetorno(r);
    } else {
      c.innerHTML = `
        <div class="barra-arvore">
          <button class="secundario pequeno" id="btnExpTudo">Expandir tudo</button>
          <button class="secundario pequeno" id="btnExpProblemas">Expandir só com problemas</button>
          <button class="secundario pequeno" id="btnRecolher">Recolher tudo</button>
        </div>
        <div class="arvore">${htmlNo(r.raiz, null, true)}</div>`;
      const todos = () => c.querySelectorAll('.arvore details');
      $('btnExpTudo').addEventListener('click', () => todos().forEach((d) => (d.open = true)));
      $('btnRecolher').addEventListener('click', () => todos().forEach((d, i) => (d.open = i === 0)));
      $('btnExpProblemas').addEventListener('click', () =>
        todos().forEach((d, i) => (d.open = i === 0 || d.classList.contains('tem-erro') || d.classList.contains('tem-aviso')))
      );
    }
  }

  function htmlRetorno(r) {
    if (!r.envio) return '<p class="vazio">Este JSON ainda não foi enviado.</p>';
    const e = r.envio;
    let h = `<p><span class="selo ${e.ok ? 'ok' : 'erro'}">HTTP ${esc(e.status ?? '—')}</span>${e.chaveRenovada ? ' <span class="selo neutro">chave renovada automaticamente</span>' : ''}</p>`;
    if (e.juntos > 1) {
      h += `<p class="vazio">Enviado junto com ${e.juntos - 1} outro(s) aluno(s), no mesmo lote.${e.ok ? '' : ' Como o envio foi em lote, os campos com problema não são marcados na cascata: use "Enviar para a API" neste aluno para ver o campo exato.'}</p>`;
    }
    if (e.erroLocal) h += `<div class="erro-bloco"><strong>${esc(e.erroLocal)}</strong></div>`;
    if (r.semCampo && r.semCampo.length) {
      h += `<h2 style="margin-top:14px">Erros da API sem campo identificado</h2><ul class="lista-erros">${r.semCampo
        .map((s) => `<li><strong>${esc(s.msg)}</strong><br><span class="sub">Possível causa: ${esc(s.causa)}</span></li>`)
        .join('')}</ul>`;
    }
    if (e.corpo !== undefined) {
      const txt = typeof e.corpo === 'string' ? e.corpo : JSON.stringify(e.corpo, null, 2);
      h += `<h2 style="margin:14px 0 8px">Resposta completa</h2><pre class="json">${esc(txt)}</pre>`;
    }
    return h;
  }

 
 
  async function chamarEnvio(json) {
    const { ok, status, dados } = await api('/api/enviar', { json });
    if (!ok && dados.erro) {
      return { ok: false, status, erroLocal: `${dados.erro}${dados.detalhe ? ' — ' + JSON.stringify(dados.detalhe).slice(0, 300) : ''}`, corpo: dados.detalhe };
    }
    return dados;
  }

 
  async function enviarSilencioso(r) {
    r.envio = await chamarEnvio(r.json);
    if (!r.envio.ok && !r.envio.erroLocal) {
      r.semCampo = V.aplicarRetornoApi(r.raiz, r.envio.corpo).semCampo;
    } else {
      r.semCampo = [];
    }
    carregarStatus();
  }

  async function enviar(r, botao) {
    botao.disabled = true;
    botao.textContent = 'Enviando…';
    await enviarSilencioso(r);
    estado.aba = r.envio.ok ? 'api' : 'arvore';
    renderLista();
    renderDetalhe();
    toast(r.envio.ok ? 'Enviado com sucesso.' : 'A API devolveu erro: veja os campos marcados na cascata.', 6000);
  }

 
 
  function montarEnvios(registros) {
    const grupos = new Map();
    const avulsos = [];
    for (const r of registros) {
      const j = r.json;
      const chave = j && typeof j === 'object' && !Array.isArray(j) ? Object.keys(j).find((k) => k.toLowerCase() === 'diplomas') : null;
      if (chave && Array.isArray(j[chave])) {
        const cab = { ...j };
        delete cab[chave];
        const gk = `${chave}|${JSON.stringify(cab)}`;
        if (!grupos.has(gk)) grupos.set(gk, { chave, cab, itens: [] });
        grupos.get(gk).itens.push(r);
      } else {
        avulsos.push(r);
      }
    }
    const envios = [...grupos.values()].map((g) => ({
      registros: g.itens,
      json: { ...g.cab, [g.chave]: g.itens.flatMap((r) => r.json[g.chave]) },
    }));
    avulsos.forEach((r) => envios.push({ registros: [r], json: r.json }));
    return envios;
  }

  $('btnEnviarTodos').addEventListener('click', async () => {
    const lote = estado.resultados.filter((r) => r.json !== undefined && !r.raiz.erros && !(r.envio && r.envio.ok));
    if (!lote.length) return toast('Nenhum aluno sem erros para enviar.');

    const envios = montarEnvios(lote);
    const msg =
      envios.length === 1
        ? `Enviar ${lote.length} aluno(s) juntos, no mesmo lote, para a API?`
        : `Enviar ${lote.length} aluno(s) para a API em ${envios.length} lotes diferentes?`;
    if (!confirm(msg)) return;

    const b = $('btnEnviarTodos');
    b.disabled = true;
    let ok = 0;
    for (let i = 0; i < envios.length; i++) {
      b.textContent = `Enviando ${i + 1}/${envios.length}…`;
      const { registros, json } = envios[i];
      const envio = await chamarEnvio(json);
      let semCampo = [];
      if (!envio.ok && !envio.erroLocal) semCampo = V.aplicarRetornoApi(V.validar(json), envio.corpo).semCampo;
      registros.forEach((r) => {
        r.envio = { ...envio, juntos: registros.length };
        r.semCampo = semCampo;
      });
      if (envio.ok) ok += registros.length;
      carregarStatus();
      renderLista();
    }
    b.disabled = false;
    b.textContent = 'Enviar todos juntos (mesmo lote)';
    renderDetalhe();
    toast(`${ok} de ${lote.length} aluno(s) enviados com sucesso.`, 6000);
  });

 
  $('ras').value = lerLocal('ras');
  carregarStatus();
  carregarParametros();
  renderLista();
})();