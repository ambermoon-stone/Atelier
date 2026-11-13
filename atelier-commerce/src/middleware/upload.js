import multer from 'multer';
import sharp from 'sharp';
import crypto from 'node:crypto';
import path from 'node:path';
import { config } from '../config.js';

const parser=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024},fileFilter:(req,file,done)=>done(null,['image/jpeg','image/png','image/webp'].includes(file.mimetype))});
export const uploadImage=parser.single('image');
export async function processUpload(req,res,next) {
  if(!req.file)return res.status(400).json({error:'INVALID_IMAGE'});
  try {
    const metadata=await sharp(req.file.buffer).metadata();
    if(!metadata.width||!metadata.height||metadata.width>8000||metadata.height>8000)throw new Error('Image dimensions are invalid.');
    const filename=`${Date.now()}-${crypto.randomBytes(6).toString('hex')}.webp`;
    await sharp(req.file.buffer).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).webp({quality:84}).toFile(path.join(config.uploadDir,filename));
    res.status(201).json({url:`/uploads/${filename}`});
  } catch(error) { next(error); }
}