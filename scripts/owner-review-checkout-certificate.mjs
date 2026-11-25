import {generateKeyPairSync, randomBytes, sign, X509Certificate} from 'node:crypto';

const HOUR = 60 * 60 * 1000;
const IP = '127.0.0.1';

function der(tag, ...parts) {
  const bytes = Buffer.concat(parts);
  const size = bytes.length;
  const length = size < 128 ? [size] : size < 256 ? [0x81,size] : [0x82,size >> 8,size & 0xff];
  return Buffer.concat([Buffer.from([tag,...length]),bytes]);
}

const sequence = (...parts) => der(0x30,...parts);
const oid = hex => der(0x06,Buffer.from(hex,'hex'));
const integer = bytes => der(0x02,Buffer.from(bytes));
const booleanTrue = der(0x01,Buffer.from([0xff]));
const extension = (id, data, critical = false) => sequence(oid(id),
  ...(critical ? [booleanTrue] : []),der(0x04,data));
const signatureAlgorithm = sequence(oid('2a8648ce3d040302')); // ecdsa-with-SHA256
const commonName = text => sequence(der(0x31,sequence(oid('550403'),der(0x0c,Buffer.from(text)))));

function certificateTime(ms) {
  const date = new Date(ms), year = date.getUTCFullYear();
  if (!Number.isSafeInteger(ms) || year < 2000 || year > 9999 || !Number.isFinite(year)) {
    throw new Error('Invalid synthetic checkout certificate clock.');
  }
  const text = date.toISOString().slice(year < 2050 ? 2 : 0,19).replace(/[-:T]/g,'')+'Z';
  return der(year < 2050 ? 0x17 : 0x18,Buffer.from(text,'ascii'));
}

function certificate({name,issuer,publicKey,signingKey,validity,extensions}) {
  const serial = randomBytes(16);
  serial[0] = (serial[0] & 0x3f) | 0x40;
  const tbs = sequence(der(0xa0,integer([2])),integer(serial),signatureAlgorithm,issuer,validity,name,
    publicKey.export({type:'spki',format:'der'}),der(0xa3,sequence(...extensions)));
  return new X509Certificate(sequence(tbs,signatureAlgorithm,der(0x03,Buffer.from([0]),sign('sha256',tbs,signingKey))));
}

export function createOwnerReviewCheckoutCertificate({now = Date.now} = {}) {
  const at = now();
  const validity = sequence(certificateTime(at-60_000),certificateTime(at+8*HOUR));
  const authority = generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const server = generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const issuer = commonName('Shenyi synthetic checkout CA');
  // The root can sign leaves only. The review launcher trusts it in one child process.
  const ca = certificate({name:issuer,issuer,validity,publicKey:authority.publicKey,signingKey:authority.privateKey,extensions:[
    extension('551d13',sequence(booleanTrue,integer([0])),true),
    extension('551d0f',der(0x03,Buffer.from([2,0x04])),true),
  ]});
  const leaf = certificate({name:commonName('Shenyi synthetic checkout'),issuer,validity,publicKey:server.publicKey,
    signingKey:authority.privateKey,extensions:[
      extension('551d13',sequence(),true),
      extension('551d0f',der(0x03,Buffer.from([7,0x80])),true),
      extension('551d25',sequence(oid('2b06010505070301'))),
      extension('551d11',sequence(der(0x87,Buffer.from([127,0,0,1])))),
    ]});
  if (!ca.ca || !ca.verify(ca.publicKey) || leaf.checkIP(IP) !== IP || leaf.ca ||
      !leaf.checkIssued(ca) || !leaf.verify(ca.publicKey)) {
    throw new Error('Invalid synthetic checkout certificate.');
  }
  return Object.freeze({cert:leaf.toString(),ca:ca.toString(),key:server.privateKey.export({type:'pkcs8',format:'pem'}),
    fingerprint256:leaf.fingerprint256,expiresAt:Date.parse(leaf.validTo)});
}
