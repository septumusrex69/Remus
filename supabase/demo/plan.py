import datetime as dt, random, json
random.seed(7)
D=dt.date
HOL={D(2025,12,16),D(2025,12,25),D(2025,12,26),D(2026,1,1),D(2026,4,3),D(2026,4,6),D(2026,4,27),D(2026,5,1),D(2026,6,16),D(2026,8,10),D(2026,9,24),D(2026,12,16),D(2026,12,25),D(2026,12,26),D(2027,1,1)}
def shut(d): return D(2025,12,17)<=d<=D(2026,1,9) or D(2026,12,17)<=d<=D(2027,1,8)
def work(d): return d.weekday()<5 and d not in HOL and not shut(d)
def nxt(d):
    while not work(d): d+=dt.timedelta(1)
    return d
def add(d,n):  # end date of n working days starting d
    d=nxt(d); c=1
    while c<n:
        d+=dt.timedelta(1)
        if work(d): c+=1
    return d
# section: days, material base, sub base, trade
T={
 'bathroom':[('Demolition',2,6000,0,'general'),('Plumbing',4,14000,9000,'plumber'),('Plastering',3,7000,0,'plasterer'),('Tiling',5,22000,0,'tiler'),('Fittings & finishes',3,26000,0,'plumber')],
 'kitchen':[('Demolition',2,5000,0,'general'),('Electrical',3,9000,8000,'general'),('Plastering',3,6000,0,'plasterer'),('Cabinets & tops',5,15000,48000,'carpenter'),('Tiling',4,16000,0,'tiler'),('Painting',2,5000,0,'painter')],
 'extension':[('Foundations',5,32000,0,'bricklayer'),('Brickwork',10,58000,0,'bricklayer'),('Roofing',6,30000,42000,'carpenter'),('Plastering',6,16000,0,'plasterer'),('Electrical & plumbing',4,18000,26000,'plumber'),('Tiling',5,24000,0,'tiler'),('Painting',4,9000,0,'painter')],
 'wall':[('Foundations',5,26000,0,'bricklayer'),('Brickwork',9,48000,0,'bricklayer'),('Plastering',5,12000,0,'plasterer'),('Painting',3,7000,0,'painter')],
 'roof':[('Strip-out',2,3000,0,'general'),('Roof sheeting',6,38000,30000,'carpenter'),('Ceilings',5,22000,0,'carpenter'),('Painting',3,8000,0,'painter')],
 'patio':[('Earthworks',3,6000,4000,'general'),('Paving',6,34000,0,'bricklayer'),('Braai & seating',5,21000,0,'bricklayer'),('Finishes',2,6000,0,'painter')],
 'fitout':[('Strip-out',3,6000,0,'general'),('Partitions & ceilings',8,52000,64000,'carpenter'),('Electrical',5,22000,48000,'general'),('Flooring',5,46000,0,'tiler'),('Painting',4,14000,0,'painter')],
}
NAMES={'bathroom':'Bathroom Remodel','kitchen':'Kitchen Revamp','extension':'Home Extension','wall':'Boundary Wall','roof':'Roof & Ceilings','patio':'Patio & Braai','fitout':'Office Fit-out'}
SUR=['Pillay','Coetzee','Ndlovu','Fourie','Khumalo','Steyn','Govender','Mthembu','Joubert','Naicker','Venter','Molefe','Pretorius','Kruger','Sithole','du Plessis','Maharaj','Nel','Zwane','Erasmus','Mabaso','Smit','Radebe','Olivier']
FIRST=['Anita','Gerhard','Thandi','Riaan','Nomsa','Marius','Kavitha','Sibusiso','Elmarie','Rajesh','Hennie','Palesa','Johan','Liezl','Mandla','Charl','Sunita','Wikus','Zanele','Danie','Lindiwe','Karin','Themba','Ilse']
SUB=['Brooklyn','Waterkloof','Lynnwood','Garsfontein','Faerie Glen','Moreleta Park','Menlo Park','Hatfield','Erasmuskloof','Centurion','Irene','Silver Lakes','Montana','Wonderboom','Rietfontein','Equestria','Constantia Park','Elarduspark']
def stages_for(kind,start,scale):
    out=[];d=start
    for i,(s,days,m,sub,tr) in enumerate(T[kind]):
        e=add(d,days)
        out.append(dict(ord=i,section=s,start=nxt(d),end=e,days=days,mat=round(m*scale,-2),sub=round(sub*scale,-2),trade=tr))
        d=e+dt.timedelta(1)
    return out
jobs=[]
def job(key,kind,start,status,factor,scale,name=None,code=None,pid=None,cid=None,stg=None):
    st=stg or stages_for(kind,start,scale)
    j=dict(key=key,kind=kind,status=status,factor=factor,start=st[0]['start'],end=st[-1]['end'],stages=st,name=name,code=code,pid=pid,cid=cid)
    jobs.append(j);return j
# fixed current / future
smith=[('Demolition',D(2026,9,9),D(2026,9,18),18000,'general'),('Electrical',D(2026,9,21),D(2026,10,2),31000,'general'),('Bathrooms',D(2026,10,5),D(2026,10,23),72720,'plumber'),('Kitchen',D(2026,10,26),D(2026,11,13),106760,'carpenter'),('Patio',D(2026,11,16),D(2026,11,25),61400,'bricklayer')]
job('smith','existing',None,'active',1.0,1,pid='3c78a141-9710-467a-8e32-f655ef9efdf5',stg=[dict(ord=i,section=s,start=a,end=b,days=0,mat=m,sub=0,trade=t) for i,(s,a,b,m,t) in enumerate(smith)])
job('naidoo','bathroom',D(2026,10,7),'active',1.12,1.0,pid='50dd6d16-a6da-4c71-9b54-94e6381c9833',cid='b6b77ad5-c480-4bf7-bf80-8892bcc91270',stg=None)
# stretch naidoo to Nov 20: re-plan with longer days
n=jobs[-1]; ds=[3,6,4,8,6]
d=D(2026,10,7); st=[]
for i,(s,_,m,sub,tr) in enumerate(T['bathroom']):
    e=add(d,ds[i]); st.append(dict(ord=i,section=s,start=nxt(d),end=e,days=ds[i],mat=m,sub=sub,trade=tr)); d=e+dt.timedelta(1)
n['stages']=st; n['end']=st[-1]['end']
job('botha','kitchen',D(2026,10,8),'active',1.09,1.15,name='Botha Kitchen Revamp')
job('mokoena','roof',D(2026,10,12),'active',0.93,1.1,name='Mokoena Roof & Ceilings')
job('centurion','fitout',D(2026,11,4),'planned',1.0,1.0,pid='271c066b-ea89-4283-b795-195045e09168')
job('pretorius','patio',D(2026,11,9),'planned',1.0,1.0,name='Pretorius Patio & Braai')
job('vanwyk','extension',D(2027,2,1),'planned',1.0,0.9,name='Van Wyk Double Garage')
fixed=[(D(2026,7,23),D(2026,9,21))]  # UHG-004
def running(day):
    return sum(1 for j in jobs if j['start']<=day<=j['end'])+sum(1 for a,b in fixed if a<=day<=b)
day=D(2025,11,3); n=0
kinds=['bathroom','kitchen','extension','wall','roof','patio','bathroom','kitchen']
while day<=D(2026,9,18):
    if work(day) and running(day)<4:
        k=random.choice(kinds); sc=random.choice([0.9,1.0,1.1,1.25])
        st=stages_for(k,day,sc)
        if st[-1]['end']<D(2026,10,20) and not any(shut(day+dt.timedelta(i)) for i in range(0,(st[-1]['end']-day).days+1)):
            job('p%d'%n,k,day,'completed',round(random.uniform(0.86,1.13),2),sc); n+=1
            continue
    day+=dt.timedelta(1)
# names for new
i=0
for j in jobs:
    if j['pid'] is None:
        if j['name'] is None:
            j['name']=f"{SUR[i%len(SUR)]} {NAMES[j['kind']]}"
        j['first']=FIRST[i%len(FIRST)]; j['last']=j['name'].split(' ')[0] if not j['name'].startswith('du ') else 'du Plessis'
        j['site']=f"{random.randint(3,280)} {random.choice(['Jacaranda','Protea','Kiaat','Marula','Acacia','Wilger','Eike','Lynnwood','Rigel','Atterbury','Garsfontein','Duncan'])} {random.choice(['Street','Avenue','Road','Crescent'])}, {random.choice(SUB)}, Pretoria"
        i+=1
# concurrency check
m=D(2025,11,1)
while m<=D(2027,3,1):
    days=[m+dt.timedelta(x) for x in range(28)]
    print(m, max(running(d) for d in days))
    m=(m.replace(day=1)+dt.timedelta(32)).replace(day=1)
print(len(jobs))
def q(v): return 'null' if v is None else "'"+str(v).replace("'","''")+"'"
J=[];S=[]
for k,j in enumerate(jobs):
    J.append(f"({q(j['key'])},{k},{q(j['kind'])},{q(j['status'])},{j['factor']},{q(j['start'])},{q(j['end'])},{q(j.get('name'))},{q(j.get('first'))},{q(j.get('last'))},{q(j.get('site'))},{q(j['pid'])}::uuid,{q(j['cid'])}::uuid)")
    for s in j['stages']:
        S.append(f"({q(j['key'])},{s['ord']},{q(s['section'])},{q(s['start'])},{q(s['end'])},{s['mat']},{s['sub']},{q(s['trade'])})")
open('jobs.sql','w').write(',\n'.join(J)); open('stages.sql','w').write(',\n'.join(S))
