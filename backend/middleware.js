// middleware.js - Auth, upload e configurações
const jwt = require('jsonwebtoken');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');

// Configurar Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Storage para imagens de evento
const storageEventos = new CloudinaryStorage({
  cloudinary,
  params: { folder: 'eventpass/eventos', allowed_formats: ['jpg', 'jpeg', 'png', 'webp'] },
});

// Storage para convites (PDFs e imagens)
const storageConvites = new CloudinaryStorage({
  cloudinary,
  params: (req, file) => ({
    folder: 'eventpass/convites',
    allowed_formats: file.mimetype === 'application/pdf' ? ['pdf'] : ['jpg', 'jpeg', 'png'],
    resource_type: file.mimetype === 'application/pdf' ? 'raw' : 'image',
  }),
});

// Storage para PDFs completos (ADM)
const storagePDFsAdmin = new CloudinaryStorage({
  cloudinary,
  params: { folder: 'eventpass/relatorios', allowed_formats: ['pdf'], resource_type: 'raw' },
});

const uploadEvento = multer({ storage: storageEventos });
const uploadConvite = multer({ storage: storageConvites });
const uploadPDFAdmin = multer({ storage: storagePDFsAdmin });

// Middleware JWT
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ erro: 'Token não fornecido' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ erro: 'Token inválido ou expirado' });
  }
};

// Middleware Admin
const adminOnly = (req, res, next) => {
  if (!req.user?.is_admin) return res.status(403).json({ erro: 'Acesso restrito ao administrador' });
  next();
};

// Excluir arquivo do Cloudinary
const deletarArquivoCloudinary = async (url, resourceType = 'image') => {
  if (!url) return;
  try {
    const partes = url.split('/');
    const folderIndex = partes.indexOf('eventpass');
    if (folderIndex === -1) return;
    const publicId = 'eventpass/' + partes.slice(folderIndex + 1).join('/').split('.')[0];
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  } catch (err) {
    console.error('Erro ao deletar arquivo Cloudinary:', err.message);
  }
};

module.exports = { auth, adminOnly, uploadEvento, uploadConvite, uploadPDFAdmin, cloudinary, deletarArquivoCloudinary };
