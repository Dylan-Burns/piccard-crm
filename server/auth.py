import os,time,hmac,hashlib,base64,json,secrets
SECRET=os.getenv('APP_SECRET','dev-only-change-me').encode()
def hash_password(password:str)->str:
 salt=secrets.token_bytes(16); digest=hashlib.pbkdf2_hmac('sha256',password.encode(),salt,310000)
 return 'pbkdf2_sha256$310000$'+base64.urlsafe_b64encode(salt).decode()+'$'+base64.urlsafe_b64encode(digest).decode()
def verify_password(password:str,encoded:str)->bool:
 try:
  _,iters,salt,digest=encoded.split('$'); got=hashlib.pbkdf2_hmac('sha256',password.encode(),base64.urlsafe_b64decode(salt),int(iters)); return hmac.compare_digest(got,base64.urlsafe_b64decode(digest))
 except Exception:return False
def token(payload:dict,ttl=86400):
 data={**payload,'exp':int(time.time())+ttl}; raw=base64.urlsafe_b64encode(json.dumps(data,separators=(',',':')).encode()).rstrip(b'='); sig=hmac.new(SECRET,raw,hashlib.sha256).digest(); return raw.decode()+'.'+base64.urlsafe_b64encode(sig).rstrip(b'=').decode()
def parse_token(value:str):
 try:
  a,b=value.split('.'); raw=a.encode(); pad=lambda s:s+'='*(-len(s)%4); sig=base64.urlsafe_b64decode(pad(b));
  if not hmac.compare_digest(sig,hmac.new(SECRET,raw,hashlib.sha256).digest()): return None
  data=json.loads(base64.urlsafe_b64decode(pad(a))); return data if data.get('exp',0)>time.time() else None
 except Exception:return None
