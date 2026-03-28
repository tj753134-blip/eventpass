# 🎟️ Eventpass — Sistema Completo de Bilhetes e Eventos

MVP completo e pronto para produção. Apenas insira suas keys para funcionar.

---

## 🗂️ Estrutura do Projeto

```
eventpass/
├── backend/
│   ├── server.js        # Servidor Express principal + cron jobs
│   ├── routes.js        # TODAS as rotas da API
│   ├── db.js            # PostgreSQL + schema automático
│   ├── middleware.js     # JWT, upload Cloudinary, helpers
│   ├── package.json
│   └── .env.example     # Copiar para .env e preencher
├── frontend/
│   └── public/
│       └── index.html   # SPA completa (HTML+CSS+JS)
├── render.yaml          # Deploy automático no Render
└── README.md
```

---

## 🚀 Deploy no Render (5 minutos)

### 1. Criar conta e repositório
1. Crie um repositório no GitHub e envie este projeto
2. Acesse [render.com](https://render.com) e conecte ao GitHub

### 2. Deploy com render.yaml
1. Clique em **"New" → "Blueprint"**
2. Selecione seu repositório
3. O Render detecta o `render.yaml` automaticamente
4. Preencha as variáveis de ambiente (veja abaixo)

### 3. Variáveis de ambiente obrigatórias
| Variável | Onde encontrar |
|---|---|
| `CLOUDINARY_CLOUD_NAME` | [cloudinary.com](https://cloudinary.com) → Dashboard |
| `CLOUDINARY_API_KEY` | Cloudinary → Settings → API Keys |
| `CLOUDINARY_API_SECRET` | Cloudinary → Settings → API Keys |
| `ADMIN_WHATSAPP` | Número do administrador (ex: `244900000000`) |
| `ADMIN_EMAIL` | Email do administrador |
| `JWT_SECRET` | Gerado automaticamente pelo Render |
| `DATABASE_URL` | Gerado automaticamente pelo Render |

### 4. Variáveis opcionais (plano Pro — envio automático)
| Variável | Para quê |
|---|---|
| `WHATSAPP_API_TOKEN` | WhatsApp Business API |
| `WHATSAPP_PHONE_ID` | ID do número WhatsApp Business |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | Envio de email |

---

## 💻 Desenvolvimento Local

```bash
# 1. Clonar
git clone <repo> && cd eventpass/backend

# 2. Instalar dependências
npm install

# 3. Configurar ambiente
cp .env.example .env
# Editar .env com suas keys

# 4. Iniciar servidor
npm run dev
# Acesse: http://localhost:3000
```

---

## 🗃️ API Endpoints

### Auth
| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/auth/registro` | Criar conta |
| POST | `/api/auth/login` | Login → token JWT |
| GET | `/api/auth/perfil` | Perfil do usuário |
| PUT | `/api/auth/perfil` | Atualizar perfil |

### Eventos
| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/eventos` | Listar eventos |
| GET | `/api/eventos/publicos` | Eventos públicos (sem auth) |
| POST | `/api/eventos` | Criar evento |
| PUT | `/api/eventos/:id` | Editar evento |
| DELETE | `/api/eventos/:id` | Excluir evento |
| POST | `/api/eventos/:id/pdf-completo` | Upload PDF (ADM) |
| DELETE | `/api/eventos/:id/pdf-completo` | Remover PDF (ADM) |

### Bilhetes
| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/bilhetes` | Meus bilhetes |
| GET | `/api/bilhetes/evento/:id` | Bilhetes por evento |
| POST | `/api/bilhetes` | Emitir bilhete + QR |
| POST | `/api/bilhetes/:id/upload-convite` | Upload PDF/imagem |
| POST | `/api/bilhetes/:id/enviar-convite` | Envio WhatsApp (Pro) |
| PUT | `/api/bilhetes/:id/bloquear` | Bloquear/liberar (ADM) |
| DELETE | `/api/bilhetes/:id` | Excluir bilhete (ADM) |

### Check-in
| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/checkin` | Validar QR + registrar entrada/saída |

### Pagamentos
| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/pagamentos` | Solicitar pagamento Pro |
| GET | `/api/pagamentos` | Listar pagamentos |
| PUT | `/api/pagamentos/:id/confirmar` | Confirmar/Rejeitar (ADM) |

### Admin
| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/admin/dashboard` | Visão geral |
| GET | `/api/admin/usuarios` | Listar usuários |
| PUT | `/api/admin/usuarios/:id/plano` | Alterar plano |
| GET | `/api/admin/relatorio/:eventoId` | Relatório completo |

---

## 👤 Criar Primeiro Admin

Após o deploy, execute no banco de dados:

```sql
UPDATE usuarios 
SET is_admin = TRUE, tipo_plano = 'pro' 
WHERE login = 'seu_login';
```

Ou via psql no Render: **Dashboard → Database → Shell**

---

## 📋 Fluxo Completo

```
1. Usuário se cadastra → gratis
2. Cria ou seleciona evento
3. Emite bilhete (QR gerado automaticamente)
4. Plano grátis: baixa convite manual
5. Plano Pro: solicita pagamento → referência gerada
6. Usuário envia Express para ADM (LOGIN + REF na mensagem)
7. ADM confirma pagamento → bilhete vira Pro
8. Sistema envia convite via WhatsApp automaticamente
9. No evento: operador escaneia QR → entrada/saída registrada
10. ADM acompanha relatórios em tempo real
```

---

## 🔐 Segurança

- Senhas: bcrypt (12 rounds)
- Auth: JWT com expiração de 7 dias  
- Anti-fraude Pro: telefone vinculado ao bilhete
- QR codes únicos — UUID + prefixo EVENTPASS
- Arquivos sensíveis apenas no Cloudinary (acesso privado ADM)

---

## 🧹 Manutenção Automática

- **Todo dia às 00h:** Histórico de bilhetes com +30 dias é apagado
- **A cada hora:** Pagamentos pendentes expirados após 2 dias são marcados como `expirado`

---

## 📦 Tecnologias

| Camada | Stack |
|---|---|
| Frontend | HTML5, CSS3, JavaScript Vanilla (SPA) |
| Backend | Node.js, Express.js |
| Banco | PostgreSQL (Render managed) |
| Arquivos | Cloudinary (QR, PDFs, imagens) |
| Auth | JWT + bcrypt |
| QR Code | `qrcode` npm package |
| Agendamento | `node-cron` |
| Deploy | Render (backend + DB) |
