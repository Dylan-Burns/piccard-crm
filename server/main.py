import os,json,uuid,pathlib
from datetime import datetime
from fastapi import FastAPI,Depends,HTTPException,Request,UploadFile,File,Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from sqlalchemy import select,func
from pydantic import BaseModel
from .db import Base,engine,db
from .models import *
from .auth import hash_password,verify_password,token,parse_token
Base.metadata.create_all(engine)
app=FastAPI(title='Roofing CRM API',version='1.0.0')
origins=[x.strip() for x in os.getenv('CORS_ORIGINS','http://localhost:5173,http://localhost:8000').split(',') if x.strip()]
app.add_middleware(CORSMiddleware,allow_origins=origins,allow_credentials=True,allow_methods=['*'],allow_headers=['*'])
class Login(BaseModel): email:str; password:str
class Bootstrap(BaseModel): company:str; name:str; email:str; password:str
class LeadIn(BaseModel): name:str; address:str; phone:str|None=None; email:str|None=None; source:str='Manual'; service:str='Roof Replacement'; value:float=0; owner_id:int|None=None; next_activity:str|None=None
class StageIn(BaseModel): stage:str
class NoteIn(BaseModel): body:str
class EventIn(BaseModel): opportunity_id:int|None=None; title:str; event_type:str='Appointment'; start_at:datetime; end_at:datetime|None=None; notes:str|None=None
class EstimateIn(BaseModel): opportunity_id:int; amount:float; line_items:list[dict]=[]; status:str='Draft'
class InvoiceIn(BaseModel): opportunity_id:int; amount:float; due_at:datetime|None=None; status:str='Draft'
def current(req:Request,s:Session=Depends(db)):
 auth=req.headers.get('authorization',''); data=parse_token(auth[7:]) if auth.lower().startswith('bearer ') else None
 if not data: raise HTTPException(401,'Authentication required')
 u=s.get(User,data['uid']);
 if not u or not u.active: raise HTTPException(401,'Invalid account')
 return u
def audit(s,u,action,kind,eid=None,detail=None): s.add(Audit(org_id=u.org_id,user_id=u.id,action=action,entity_type=kind,entity_id=eid,detail=detail))
def lead_dict(s,o):
 c=s.get(Customer,o.customer_id); owner=s.get(User,o.owner_id) if o.owner_id else None
 return {'id':o.id,'customer_id':c.id,'name':c.name,'address':c.address,'phone':c.phone,'email':c.email,'source':o.source,'stage':o.stage,'value':o.value,'service':o.service,'owner':owner.name if owner else 'Unassigned','owner_id':o.owner_id,'next':o.next_activity or 'Needs follow-up','created_at':o.created_at.isoformat()}
@app.get('/api/health')
def health(): return {'ok':True,'version':'1.0.0'}
@app.post('/api/bootstrap')
def bootstrap(x:Bootstrap,s:Session=Depends(db)):
 if s.scalar(select(func.count()).select_from(User))>0: raise HTTPException(409,'Already initialized')
 if len(x.password)<10: raise HTTPException(400,'Password must be at least 10 characters')
 org=Org(name=x.company); s.add(org); s.flush(); u=User(org_id=org.id,name=x.name,email=x.email.lower(),password_hash=hash_password(x.password),role='admin'); s.add(u); s.commit(); return {'token':token({'uid':u.id,'oid':org.id}),'user':{'name':u.name,'email':u.email,'role':u.role}}
@app.post('/api/login')
def login(x:Login,s:Session=Depends(db)):
 u=s.scalar(select(User).where(User.email==x.email.lower()));
 if not u or not verify_password(x.password,u.password_hash): raise HTTPException(401,'Invalid email or password')
 return {'token':token({'uid':u.id,'oid':u.org_id}),'user':{'name':u.name,'email':u.email,'role':u.role}}
@app.get('/api/me')
def me(u=Depends(current)): return {'id':u.id,'name':u.name,'email':u.email,'role':u.role,'org_id':u.org_id}
@app.get('/api/leads')
def leads(s:Session=Depends(db),u=Depends(current)):
 return [lead_dict(s,o) for o in s.scalars(select(Opportunity).where(Opportunity.org_id==u.org_id).order_by(Opportunity.updated_at.desc())).all()]
@app.post('/api/leads')
def create_lead(x:LeadIn,s:Session=Depends(db),u=Depends(current)):
 c=Customer(org_id=u.org_id,name=x.name,address=x.address,phone=x.phone,email=x.email); s.add(c); s.flush(); o=Opportunity(org_id=u.org_id,customer_id=c.id,source=x.source,service=x.service,value=x.value,owner_id=x.owner_id,next_activity=x.next_activity); s.add(o); s.flush(); audit(s,u,'create','opportunity',o.id); s.commit(); return lead_dict(s,o)
@app.patch('/api/leads/{oid}/stage')
def stage(oid:int,x:StageIn,s:Session=Depends(db),u=Depends(current)):
 o=s.scalar(select(Opportunity).where(Opportunity.id==oid,Opportunity.org_id==u.org_id));
 if not o: raise HTTPException(404)
 allowed=['New Lead','Contacted','Inspection','Estimate Sent','Won','Lost'];
 if x.stage not in allowed: raise HTTPException(400,'Invalid stage')
 o.stage=x.stage; o.updated_at=datetime.utcnow(); audit(s,u,'stage_change','opportunity',o.id,x.stage)
 if x.stage=='Won' and not s.scalar(select(Job).where(Job.opportunity_id==o.id)): s.add(Job(org_id=u.org_id,opportunity_id=o.id,status='Pending scheduling'))
 s.commit(); return lead_dict(s,o)
@app.get('/api/leads/{oid}')
def detail(oid:int,s:Session=Depends(db),u=Depends(current)):
 o=s.scalar(select(Opportunity).where(Opportunity.id==oid,Opportunity.org_id==u.org_id));
 if not o: raise HTTPException(404)
 d=lead_dict(s,o); d['notes']=[{'id':n.id,'body':n.body,'created_at':n.created_at.isoformat()} for n in s.scalars(select(Note).where(Note.opportunity_id==oid,Note.org_id==u.org_id).order_by(Note.created_at.desc()))]; d['documents']=[{'id':z.id,'name':z.name,'size':z.size,'content_type':z.content_type} for z in s.scalars(select(Document).where(Document.opportunity_id==oid,Document.org_id==u.org_id))]; return d
@app.post('/api/leads/{oid}/notes')
def note(oid:int,x:NoteIn,s:Session=Depends(db),u=Depends(current)):
 if not s.scalar(select(Opportunity).where(Opportunity.id==oid,Opportunity.org_id==u.org_id)): raise HTTPException(404)
 n=Note(org_id=u.org_id,opportunity_id=oid,author_id=u.id,body=x.body); s.add(n); audit(s,u,'note','opportunity',oid); s.commit(); return {'id':n.id,'body':n.body,'created_at':n.created_at.isoformat()}
@app.post('/api/leads/{oid}/documents')
async def upload(oid:int,file:UploadFile=File(...),s:Session=Depends(db),u=Depends(current)):
 if not s.scalar(select(Opportunity).where(Opportunity.id==oid,Opportunity.org_id==u.org_id)): raise HTTPException(404)
 data=await file.read(); max_size=25*1024*1024
 if len(data)>max_size: raise HTTPException(413,'File exceeds 25MB')
 root=pathlib.Path(os.getenv('STORAGE_PATH','./uploads')); root.mkdir(parents=True,exist_ok=True); key=f'{u.org_id}/{oid}/{uuid.uuid4().hex}-{pathlib.Path(file.filename or "file").name}'; path=root/key; path.parent.mkdir(parents=True,exist_ok=True); path.write_bytes(data)
 z=Document(org_id=u.org_id,opportunity_id=oid,name=file.filename or 'file',storage_key=key,content_type=file.content_type,size=len(data)); s.add(z); audit(s,u,'upload','document',None,z.name); s.commit(); return {'id':z.id,'name':z.name,'size':z.size}
@app.get('/api/documents/{did}')
def download(did:int,s:Session=Depends(db),u=Depends(current)):
 z=s.scalar(select(Document).where(Document.id==did,Document.org_id==u.org_id));
 if not z: raise HTTPException(404)
 path=pathlib.Path(os.getenv('STORAGE_PATH','./uploads'))/z.storage_key
 if not path.exists(): raise HTTPException(404,'Stored file missing')
 return FileResponse(path,media_type=z.content_type,filename=z.name)
@app.get('/api/events')
def events(s:Session=Depends(db),u=Depends(current)): return [{'id':e.id,'opportunity_id':e.opportunity_id,'title':e.title,'event_type':e.event_type,'start_at':e.start_at.isoformat(),'end_at':e.end_at.isoformat() if e.end_at else None,'notes':e.notes} for e in s.scalars(select(Event).where(Event.org_id==u.org_id).order_by(Event.start_at))]
@app.post('/api/events')
def add_event(x:EventIn,s:Session=Depends(db),u=Depends(current)):
 e=Event(org_id=u.org_id,**x.model_dump()); s.add(e); s.flush(); audit(s,u,'create','event',e.id); s.commit(); return {'id':e.id}
@app.get('/api/jobs')
def jobs(s:Session=Depends(db),u=Depends(current)): return [{'id':j.id,'opportunity_id':j.opportunity_id,'status':j.status,'start_at':j.start_at.isoformat() if j.start_at else None,'description':j.description} for j in s.scalars(select(Job).where(Job.org_id==u.org_id))]
@app.get('/api/estimates')
def estimates(s:Session=Depends(db),u=Depends(current)): return [{'id':e.id,'opportunity_id':e.opportunity_id,'number':e.number,'status':e.status,'amount':e.amount,'line_items':json.loads(e.line_items_json)} for e in s.scalars(select(Estimate).where(Estimate.org_id==u.org_id))]
@app.post('/api/estimates')
def add_estimate(x:EstimateIn,s:Session=Depends(db),u=Depends(current)):
 n=s.scalar(select(func.count()).select_from(Estimate).where(Estimate.org_id==u.org_id))+1; e=Estimate(org_id=u.org_id,opportunity_id=x.opportunity_id,number=f'EST-{n:05d}',status=x.status,amount=x.amount,line_items_json=json.dumps(x.line_items)); s.add(e); s.flush(); audit(s,u,'create','estimate',e.id); s.commit(); return {'id':e.id,'number':e.number}
@app.get('/api/invoices')
def invoices(s:Session=Depends(db),u=Depends(current)): return [{'id':i.id,'opportunity_id':i.opportunity_id,'number':i.number,'status':i.status,'amount':i.amount,'due_at':i.due_at.isoformat() if i.due_at else None} for i in s.scalars(select(Invoice).where(Invoice.org_id==u.org_id))]
@app.post('/api/invoices')
def add_invoice(x:InvoiceIn,s:Session=Depends(db),u=Depends(current)):
 n=s.scalar(select(func.count()).select_from(Invoice).where(Invoice.org_id==u.org_id))+1; i=Invoice(org_id=u.org_id,opportunity_id=x.opportunity_id,number=f'INV-{n:05d}',status=x.status,amount=x.amount,due_at=x.due_at); s.add(i); s.flush(); audit(s,u,'create','invoice',i.id); s.commit(); return {'id':i.id,'number':i.number}
@app.get('/api/reports/summary')
def report(s:Session=Depends(db),u=Depends(current)):
 ops=s.scalars(select(Opportunity).where(Opportunity.org_id==u.org_id)).all(); total=sum(x.value for x in ops); won=sum(x.value for x in ops if x.stage=='Won'); return {'open_leads':sum(1 for x in ops if x.stage not in ('Won','Lost')),'pipeline_value':total,'won_revenue':won,'close_rate':round(100*sum(1 for x in ops if x.stage=='Won')/len(ops),1) if ops else 0}
@app.post('/api/webhooks/leads/{org_id}')
def website_lead(org_id:int,x:LeadIn,request:Request,s:Session=Depends(db)):
 secret=request.headers.get('x-webhook-secret'); expected=os.getenv('LEAD_WEBHOOK_SECRET')
 if not expected or secret!=expected: raise HTTPException(401)
 if not s.get(Org,org_id): raise HTTPException(404)
 c=Customer(org_id=org_id,name=x.name,address=x.address,phone=x.phone,email=x.email); s.add(c); s.flush(); o=Opportunity(org_id=org_id,customer_id=c.id,source=x.source,service=x.service,value=x.value,next_activity='New website lead'); s.add(o); s.commit(); return {'id':o.id}
if pathlib.Path('dist').exists():
 app.mount('/assets',StaticFiles(directory='dist/assets'),name='assets')
 @app.get('/{path:path}')
 def spa(path:str):
  p=pathlib.Path('dist')/path
  return FileResponse(p if p.is_file() else 'dist/index.html')
