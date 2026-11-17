#!/bin/sh
# S-1, passo 5: mostra o QR code da instância de teste numa página que se atualiza sozinha, até
# o número conectar (ou 10 minutos). O QR nunca aparece em texto: só como PNG numa pasta 0700.
#
#   sh spikes/crm/s1-evolution/qr.sh
#
# Precisa do .env.instance ao lado (INST e INST_TOKEN, 0600, fora do git) e da Evolution ligada.
set -eu
cd "$(dirname "$0")"
[ -f .env.instance ] || { echo "Falta o .env.instance (passo 4 do README)."; exit 1; }
. ./.env.instance
EVO=http://127.0.0.1:8080
DIR="${TMPDIR:-/tmp}/agent-office-qr"
umask 077
mkdir -p "$DIR" && chmod 700 "$DIR"
rm -f "$DIR/qr.png" "$DIR/ok.png"

cat > "$DIR/qr.html" <<'HTML'
<!doctype html>
<meta charset="utf-8">
<title>Agent Office · QR do número de teste</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #13141f; color: #eceaf6; font: 16px system-ui, sans-serif; }
  main { text-align: center; max-width: 440px; padding: 24px; }
  img { width: 320px; height: 320px; background: #fff; border-radius: 12px; padding: 12px; }
  p { color: #b3b1cb; line-height: 1.5; }
  .ok { color: #8fe3bf; font-size: 22px; font-weight: 700; }
</style>
<main>
  <h1>Leia com o celular de teste</h1>
  <p>WhatsApp → Aparelhos conectados → Conectar um aparelho. O código troca sozinho a cada poucos segundos; esta página acompanha.</p>
  <img id="qr" alt="QR code da instância de teste">
  <p id="msg">Esperando o QR…</p>
</main>
<script>
  const img = document.getElementById('qr'), msg = document.getElementById('msg')
  const tick = () => {
    const ok = new Image()
    ok.onload = () => { img.remove(); msg.className = 'ok'; msg.textContent = 'Conectado. Pode fechar esta página.' }
    ok.onerror = () => { img.src = 'qr.png?' + Date.now(); }
    ok.src = 'ok.png?' + Date.now()
  }
  img.onload = () => (msg.textContent = 'QR atualizado às ' + new Date().toLocaleTimeString('pt-BR'))
  tick(); setInterval(tick, 3000)
</script>
HTML

state() { curl -s --max-time 5 "$EVO/instance/connectionState/$INST" -H "apikey: $INST_TOKEN" | jq -r '.instance.state // empty'; }
fetch_qr() {
  curl -s --max-time 10 "$EVO/instance/connect/$INST" -H "apikey: $INST_TOKEN" \
    | jq -r '.base64 // empty' | sed 's/^data:image\/png;base64,//' > "$DIR/qr.b64"
  if [ -s "$DIR/qr.b64" ]; then base64 -d -i "$DIR/qr.b64" -o "$DIR/qr.tmp" 2>/dev/null && mv "$DIR/qr.tmp" "$DIR/qr.png"; fi
  rm -f "$DIR/qr.b64"
}

opened=0
end=$(( $(date +%s) + 600 ))
while [ "$(date +%s)" -lt "$end" ]; do
  s=$(state)
  if [ "$s" = "open" ]; then
    rm -f "$DIR/qr.png"
    cp ../../../resources/icon.png "$DIR/ok.png"
    echo "Conectado. O QR foi apagado de $DIR."
    exit 0
  fi
  fetch_qr
  if [ "$opened" = 0 ] && [ -f "$DIR/qr.png" ]; then
    open "$DIR/qr.html"
    echo "QR aberto no navegador: $DIR/qr.html (imagem em $DIR/qr.png)"
    opened=1
  fi
  sleep 5
done
rm -f "$DIR/qr.png"
echo "Passaram 10 minutos sem conectar. Rode de novo quando estiver com o celular de teste na mão."
exit 1
