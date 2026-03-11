# Deploy no Cloudflare Pages (via GitHub)

## 1) Publicar no GitHub
1. Crie um repositorio no GitHub.
2. Envie o projeto:

```bash
git init
git add .
git commit -m "chore: prepare project for cloudflare pages"
git branch -M main
git remote add origin <URL_DO_REPOSITORIO>
git push -u origin main
```

## 2) Conectar no Cloudflare Pages
1. Acesse Cloudflare Dashboard > Workers & Pages > Create > Pages.
2. Selecione Connect to Git e escolha o repositorio.
3. Configure:
   - Framework preset: `Vite`
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Node version: `22`
4. Clique em Save and Deploy.

## 3) Variaveis de ambiente
Se precisar de variaveis, adicione no Cloudflare Pages em Settings > Environment variables.

## 4) SPA routing
O arquivo `public/_redirects` ja esta configurado para fallback de rotas:

```text
/* /index.html 200
```
