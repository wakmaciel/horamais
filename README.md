# Hora+

Calculadora de horas extras (PJ e CLT) em PWA — instala na tela inicial do iPhone e funciona offline.

- **PJ:** valor hora = salário ÷ horas mensais → horas extras × valor hora → **salário + HE = valor da NF**. Adicional % e impostos da NF são opcionais.
- **CLT:** divisor legal (44h = 220h), HE 50% em dias úteis e 100% em domingos/feriados, DSR sobre HE (feriados nacionais calculados automaticamente), INSS e IRRF 2026 (com o redutor da Lei 15.270/2025) e FGTS informativo.

Tudo fica salvo só no aparelho (localStorage).

## Publicar no GitHub Pages

```bash
git add .
git commit -m "Hora+ PWA"
git push -u origin main
```

No GitHub: **Settings → Pages → Source: Deploy from a branch → Branch `main` / `(root)` → Save**.
Em ~1 min o app fica em **https://wakmaciel.github.io/horamais/**.

## Instalar no iPhone

1. Abra o link no **Safari**.
2. Toque em **Compartilhar** → **Adicionar à Tela de Início**.
3. Abra pelo ícone **Hora+** — abre em tela cheia, sem barra do navegador.

## Atualizar

Depois de alterar arquivos, mude `CACHE = 'horaplus-v1'` em `sw.js` (ex.: `v2`) antes do push para o celular pegar a versão nova.

## Testar localmente

```bash
python -m http.server 8080
```
