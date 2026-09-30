# Backlog

## Regra "Arena que fecha"

Regra opcional que vale para qualquer modo, escolhida como "Regras: Clássico / Arena que fecha".

- **Onde escolher:** na tela do bot (junto da dificuldade e da quantidade), numa tela antes do mesmo teclado e no lobby online, onde o dono da sala escolhe e todos veem antes de marcar pronto.
- **Tempo:** cada rodada tem 2 minutos, com relógio no topo que fica vermelho no último meio minuto.
- **Fechamento:** quando o tempo acaba, blocos de pedra caem em espiral da borda para o centro, um a cada fração de segundo, com aviso piscando na casa antes de cair.
- **Esmagamento:** o bloco elimina quem estiver embaixo e destrói bomba e power-up daquela casa. Se os últimos forem esmagados juntos, é empate.
- **Bots:** as próximas casas da espiral entram no mapa de perigo que eles usam para fugir de bomba. Validar com simulação que não morrem esmagados à toa.
- **Online:** a regra vai no protocolo e o servidor precisa da versão nova. O Render atualiza com o push; o servidor da Cloudflare no PC precisa ser reiniciado (o link muda).
- **Ajuste depois de jogar:** tempo da rodada e velocidade da espiral.

## Hospedar na Oracle Cloud

Alternativa ao Render para ping menor (servidor em São Paulo, cerca de 10 a 30 ms contra 120 a 150 ms nos EUA) e sem dormir.

- VM Always Free com Ubuntu na região Brazil East (São Paulo).
- Liberar as portas 80 e 443 na Security List e no firewall do Ubuntu.
- Node, clone do repositório, build e servidor como serviço do sistema, com `HOST=0.0.0.0` e `TRUST_PROXY=1`.
- HTTPS com Caddy e endereço gratuito do tipo `IP.sslip.io`.
- Deploy a cada push com GitHub Actions.
- Conferir a regra de recolhimento de VM ociosa e, se preciso, mudar a conta para Pay As You Go.
