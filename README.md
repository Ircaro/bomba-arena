# Bomba Arena

Jogo de bombas em arena, no estilo dos clássicos do gênero, que roda no navegador. Dá para jogar sozinho contra um bot, em duas pessoas no mesmo teclado ou online com até 4 jogadores, cada um no seu computador.

## Destaques

- **Jogabilidade:** arena 15x13 com pilares fixos e caixas destrutíveis, bombas com explosão em cruz e reação em cadeia, power-ups (bomba extra, alcance e velocidade), rodadas com empate e partida decidida por quem vencer 3 rodadas.
- **Gráficos em Canvas 2D:** tudo desenhado em código, sem imagens. Terreno com textura e sombras, caixas e pilares em pseudo-3D, personagens animados (caminhada, piscar, comemoração, nocaute com fantasminha), chamas com brilho, partículas, marcas de queimado e tremida de tela. Nítido em qualquer zoom ou DPI.
- **Som sintetizado:** efeitos e música gerados na hora pela Web Audio API, sem arquivos de áudio. Os níveis foram medidos para nada distorcer, e o som sai do lado da tela onde o evento acontece.
- **Bot:** adversário que prevê explosões com as mesmas regras do jogo, foge das bombas, abre caminho pelas caixas, pega power-ups e caça o jogador.
- **Online:** servidor autoritativo em Node com WebSocket. Salas por link com código de 6 caracteres, escolha de nome e cor, sistema de "pronto" com contagem de 5 segundos, ping de cada jogador na tela e espectador para quem entra no meio de uma rodada.
- **Acessibilidade:** respeita a preferência de reduzir movimento (desliga a tremida e as animações da página).

## Estrutura

Monorepo com npm workspaces, todo em TypeScript.

| Pacote | O que faz |
|---|---|
| `packages/shared` | Regras puras e determinísticas (mapa, movimento, bombas, explosões, power-ups, placar), bot, detector de eventos da partida e protocolo online. Roda igual no navegador e no servidor. |
| `packages/client` | Vite + Canvas 2D: renderização, efeitos, som, HUD, telas, entrada de teclado e cliente online com interpolação. |
| `packages/server` | Servidor Node que entrega o jogo e roda as salas online, com túnel opcional da Cloudflare. |

## Comandos

```bash
npm install
npm run dev        # desenvolvimento em http://localhost:5173
npm test           # testes automatizados (Vitest)
npm run typecheck  # checagem de tipos dos três pacotes
npm run build      # gera packages/client/dist
npm run host       # build + servidor em http://localhost:8080, só neste computador
npm run online     # build + servidor + túnel público da Cloudflare
npm run rede       # build + servidor aberto na rede local e em VPNs como Radmin, Hamachi e ZeroTier
npm run direto     # build + servidor aberto no IPv6 público, sem intermediário
```

Para testar o modo online durante o desenvolvimento, deixe `npm run host` rodando: o `npm run dev` repassa as conexões para ele.

Para rodar dois modos ao mesmo tempo, mude a porta de um deles:

```bash
PORT=8081 npm run direto            # Git Bash
$env:PORT=8081; npm run direto      # PowerShell
```

## Jogar online

1. Suba o servidor com um dos modos abaixo.
2. Abra `http://localhost:8080` (ou a porta que você escolheu), clique em **Jogar online** e copie o link de convite.
3. Mande o link. Cada pessoa escolhe nome e cor e marca **Estou pronto**. Quando todos marcam, a partida começa em 5 segundos. Se alguém desmarcar, sair ou entrar, a contagem cancela. Entre rodadas é igual, com 3 segundos.

| Modo | Quem consegue entrar | Observações |
|---|---|---|
| `npm run online` | Qualquer pessoa com o link | Passa pela Cloudflare, sem mexer no roteador. O link muda a cada vez que o servidor sobe. |
| `npm run direto` | Quem tem internet com IPv6 | Conexão direta com o seu PC, sem intermediário. Depende do roteador aceitar conexões IPv6 de fora. |
| `npm run rede` | Quem está na mesma rede ou na mesma VPN | Mesmo Wi-Fi ou programas como Radmin VPN. O convite usa o IP da VPN, se houver. |

O servidor só funciona enquanto o processo estiver rodando e o computador ligado.

O ping de cada jogador aparece no HUD e na sala. Como o servidor roda no seu PC, o ping de quem entrou pelo link é praticamente o atraso entre vocês. Pela Cloudflare, os pacotes passam pelo ponto de São Paulo; pelo modo direto, vão de um computador ao outro.

## Controles

**Contra o bot:** WASD ou setas para mover, Espaço ou Enter para soltar bomba, Esc pausa.

**Mesmo teclado:**

| Jogador | Mover | Bomba |
|---|---|---|
| 1 | W A S D | Espaço |
| 2 | Setas | Enter |

Esc pausa.

**Online:** cada um joga no próprio teclado, com WASD ou setas para mover e Espaço ou Enter para soltar bomba. Enter ou Espaço também marcam "pronto" na sala.

Em qualquer modo, M liga e desliga o som. O cabeçalho tem botões para o som e para a música.

## Segurança do modo online

- O servidor entrega só os arquivos do build do jogo, com proteção contra acesso a arquivos fora dessa pasta.
- Toda mensagem dos jogadores é validada, com limite de tamanho e de frequência. Nomes passam por limpeza de caracteres de controle e têm até 16 caracteres.
- Tentativas de entrar em sala inexistente são limitadas por endereço, o que impede chutar códigos.
- No modo padrão e no modo túnel, o servidor escuta só no próprio computador.
- O link da sala funciona como link de reunião: quem tiver o link entra. Mande só para quem vai jogar.

## Testes

```bash
npm test
```

Cobrem as regras do jogo (movimento, colisão, bombas, reação em cadeia, power-ups, fim de rodada e placar), o bot (previsão de explosão igual à do motor, fuga de bombas, sobrevivência e vitória contra adversário parado), o detector de eventos e o protocolo online (validação de mensagens, código de sala, limpeza de nomes e sincronização de estado entre servidor e cliente).
