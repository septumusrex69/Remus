import math
W,H=1800,640
G=560  # ground line
o=[]
def L(d,op=.6,w=1,dash=None): o.append(f'<path d="{d}" stroke-opacity="{op}" stroke-width="{w}"'+(f' stroke-dasharray="{dash}"' if dash else '')+'/>')
def T(x,y,t,size=11,op=.55,anchor='start'): o.append(f'<text x="{x}" y="{y}" font-size="{size}" fill-opacity="{op}" text-anchor="{anchor}">{t}</text>')
# perspective ground grid
vp=(1150,G-170)
for i in range(-14,30):
    x=i*70
    L(f'M{x} {H} L{vp[0]+(x-vp[0])*0.0} {vp[1]}' if False else f'M{x} {H}L{vp[0]+(x-vp[0])*0.18:.0f} {G}',.06)
for k,y in enumerate([G+8,G+20,G+38,G+64,G+100]):
    L(f'M0 {y}H{W}',.05+k*0.01)
L(f'M0 {G}H{W}',.7,1.4)
# helper: tower with floor lines
def tower(x,w,h,floors,op=.62,taper=0):
    top=G-h
    L(f'M{x} {G}V{top}H{x+w}V{G}',op,1.3)
    n=int(h/floors)
    for f in range(1,n):
        y=G-f*floors
        L(f'M{x} {y}H{x+w}',op*.35)
    return top
import random
random.seed(11)
# 0. the city behind: a far row of towers, faint, so the drawing has depth
bx=0
while bx < W:
    bw=random.choice([30,40,50,60]); bh=random.randint(120,330)
    L(f'M{bx} {G}V{G-bh}H{bx+bw}V{G}',.1)
    for f in range(1,bh//18): L(f'M{bx} {G-f*18}H{bx+bw}',.035)
    if random.random()<.25: L(f'M{bx+bw/2} {G-bh}V{G-bh-random.randint(20,60)}',.12)
    bx+=bw+random.choice([0,6,12])
def lit(x,w,h,floor,n,op=.55):
    # windows with the lights on: small bright cells scattered up a tower
    for _ in range(n):
        f=random.randint(1,max(1,int(h/floor)-1)); c=random.random()
        o.append(f'<rect x="{x+4+c*(w-14):.0f}" y="{G-f*floor+3}" width="6" height="{max(3,floor-7)}" fill="#e6e8eb" fill-opacity="{op*random.uniform(.35,1):.2f}" stroke="none"/>')
def mullions(x,w,h,step,op=.14):
    for k in range(1,int(w/step)): L(f'M{x+k*step} {G}V{G-h}',op)
# 1. tapered spire tower
x0,w0,h0=380,120,430
top=G-h0
L(f'M{x0} {G}L{x0+18} {top}L{x0+w0/2} {top-110}L{x0+w0-18} {top}L{x0+w0} {G}',.75,1.4)
for f in range(1,int(h0/14)):
    y=G-f*14; t=f*14/h0*18
    L(f'M{x0+t:.1f} {y}H{x0+w0-t:.1f}',.22)
L(f'M{x0+w0/2} {top-110}V{top-170}',.6)  # antenna
L(f'M{x0+w0/2} {G}V{top-110}',.18,1,'4 6')
# 2. twisting tower (series of rotated slabs drawn as offset trapezoids)
x1,w1,h1=600,110,380
prev=None
for f in range(0,int(h1/16)+1):
    y=G-f*16; s=math.sin(f*0.18)*22
    l,r=x1+s, x1+w1+s
    L(f'M{l:.1f} {y}H{r:.1f}',.32 if f%5 else .6)
    if prev: L(f'M{prev[0]:.1f} {prev[2]}L{l:.1f} {y}M{prev[1]:.1f} {prev[2]}L{r:.1f} {y}',.55)
    prev=(l,r,y)
# 3. stacked cantilever blocks
x2=820
blocks=[(0,0,220,90),(40,90,200,80),(-30,170,240,70),(60,240,170,90),(10,330,190,60)]
for dx,b,w,h in blocks:
    y=G-b-h
    L(f'M{x2+dx} {G-b}V{y}H{x2+dx+w}V{G-b}Z',.62,1.2)
    for k in range(1,6): L(f'M{x2+dx+k*w/6:.0f} {y+6}V{G-b-4}',.16)
# 4. dome / arena
cx,r=1180,150
L(f'M{cx-r} {G}A{r} {r*0.75} 0 0 1 {cx+r} {G}',.62,1.3)
for k in range(1,6):
    rr=r*k/6
    L(f'M{cx-rr:.0f} {G}A{rr:.0f} {r*0.75:.0f} 0 0 1 {cx+rr:.0f} {G}',.14)
for a in range(15,180,15):
    t=math.radians(a); L(f'M{cx} {G}L{cx+math.cos(t)*r:.0f} {G-math.sin(t)*r*0.75:.0f}',.1)
# 5. tall slab tower with crown + 6. slim twins
tower(1400,90,470,12,.6); L(f'M1400 {G-470}L1445 {G-540}L1490 {G-470}',.6,1.3); L(f'M1445 {G-540}V{G-600}',.5)
tower(1520,50,330,10,.5); tower(1580,50,300,10,.45)
tower(250,90,240,12,.45); tower(150,70,180,12,.35); tower(60,60,260,12,.3); tower(1680,80,210,12,.35)
mullions(1400,90,470,15); lit(1400,90,470,12,26)
mullions(1520,50,330,12); lit(1520,50,330,10,12); lit(1580,50,300,10,10)
lit(250,90,240,12,10,.4); lit(60,60,260,12,8,.35); lit(1680,80,210,12,8,.35)
# a ring tower: a slim stem carrying a halo ring and a pod
rx=1320
L(f'M{rx-8} {G}V{G-300}M{rx+8} {G}V{G-300}',.5,1.2)
for k in range(1,15): L(f'M{rx-8} {G-k*20}H{rx+8}',.2)
o.append(f'<ellipse cx="{rx}" cy="{G-330}" rx="70" ry="16" stroke-opacity=".6" stroke-width="1.3"/>')
o.append(f'<ellipse cx="{rx}" cy="{G-330}" rx="52" ry="11" stroke-opacity=".3"/>')
o.append(f'<ellipse cx="{rx}" cy="{G-360}" rx="26" ry="30" stroke-opacity=".55" stroke-width="1.2"/>')
L(f'M{rx} {G-390}V{G-450}',.5)
# helipad on the slab tower
o.append(f'<ellipse cx="1445" cy="{G-470}" rx="34" ry="5" stroke-opacity=".5"/>')
# searchlight beams from the spire
L(f'M440 {G-540}L300 0M440 {G-540}L560 0',.08,1)
# a monorail sweeping through the towers, with a train on it
L(f'M0 {G-150}C 400 {G-230}, 800 {G-120}, 1200 {G-200}S 1700 {G-260}, {W} {G-230}',.42,1.3)
L(f'M0 {G-142}C 400 {G-222}, 800 {G-112}, 1200 {G-192}S 1700 {G-252}, {W} {G-222}',.18)
for k in range(0,10): x=60+k*180; L(f'M{x} {G}V{G-150-math.sin(k)*30:.0f}',.12)
L(f'M700 {G-162}q8 -14 30 -14h110q22 0 30 14z',.6,1.2)
for k in range(0,5): L(f'M{742+k*20} {G-172}h12v6h-12z',.4)
# flying craft with dashed paths
for (fx,fy,tx,ty) in [(1120,90,1600,40),(180,120,560,60),(1500,150,1220,110)]:
    L(f'M{fx} {fy}L{tx} {ty}',.18,1,'3 7')
    L(f'M{tx-12} {ty}l12 -4l12 4l-12 4z',.6)
# light points on the very tops
for (x,y) in [(440,G-600),(1445,G-600),(1300,G-450),(1005,G-520)]:
    o.append(f'<circle cx="{x}" cy="{y}" r="2.5" fill="#f6f6f4" fill-opacity=".9" stroke="none"/>')
    o.append(f'<circle cx="{x}" cy="{y}" r="9" stroke-opacity=".25"/>')
# skybridge between twins
L(f'M1570 {G-250}H1580M1570 {G-238}H1580',.5)
# cable bridge across the foreground at left
L(f'M0 {G-40}H360',.45); L(f'M90 {G-40}V{G-190}M270 {G-40}V{G-190}',.5,1.2)
for k in range(0,9): L(f'M90 {G-190}L{20+k*20} {G-40}M270 {G-190}L{200+k*20} {G-40}',.14)
# tower crane over the stacked blocks
cxr=1000
L(f'M{cxr} {G}V{G-470}',.55,1.2); L(f'M{cxr+10} {G}V{G-470}',.55,1.2)
for k in range(0,23): y=G-k*20; L(f'M{cxr} {y}L{cxr+10} {y-20}',.25)
L(f'M{cxr-120} {G-470}H{cxr+220}M{cxr-120} {G-458}H{cxr+220}',.55,1.1)
for k in range(0,17): x=cxr-120+k*20; L(f'M{x} {G-458}L{x+10} {G-470}L{x+20} {G-458}',.22)
L(f'M{cxr+5} {G-470}V{G-520}L{cxr+220} {G-470}M{cxr+5} {G-520}L{cxr-120} {G-470}',.4)
L(f'M{cxr+170} {G-458}V{G-330}',.4); L(f'M{cxr+160} {G-330}h20v14h-20z',.5)
# datum levels at the right edge
for lvl,lab in [(0,'+0.000'),(160,'+48.000'),(320,'+96.000'),(470,'+141.000')]:
    y=G-lvl; L(f'M{W-150} {y}H{W-30}',.35,1,'8 4'); L(f'M{W-40} {y-8}l8 8l-8 8',.5); T(W-150,y-6,f'FFL {lab}',10,.6)
# grid bubbles along the top
for i,x in enumerate([440,655,920,1180,1445]):
    L(f'M{x} {G}V{H-28}',.12,1,'4 4'); o.append(f'<circle cx="{x}" cy="{H-15}" r="12" stroke-opacity=".45"/>'); T(x,H-11,'ABCDE'[i],10,.7,'middle')
# dimension string
L(f'M380 {G+30}H1490M380 {G+22}V{G+38}M1490 {G+22}V{G+38}',.35); T(935,G+46,'1 110 000',10,.55,'middle')
T(40,G+46,'REMUS · URBAN SKYLINE · ELEVATION 1:500',10,.5)
body=chr(10).join(x for x in o if not x.startswith('<text'))
svg=f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".25" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <mask id="reflect"><rect x="0" y="{G}" width="{W}" height="{H-G}" fill="url(#fade)"/></mask>
  </defs>
  <!-- the city mirrored in the wet ground, fading out -->
  <g mask="url(#reflect)"><g transform="translate(0 {2*G}) scale(1 -1)" fill="none" stroke="#c4c8cf">{body}</g></g>
  <!-- Remus · Handover 6: the Platinum Night hero ("something cool like a futuristic city"). Line elevation in silver; generated by a script, see HANDOVER. -->
  <g fill="none" stroke="#c4c8cf" stroke-linecap="square">
{chr(10).join(x for x in o if not x.startswith('<text'))}
  </g>
  <g fill="#c4c8cf" font-family="Inter, Arial, sans-serif" letter-spacing="2">
{chr(10).join(x for x in o if x.startswith('<text'))}
  </g>
</svg>'''
open(__import__('os').path.join(__import__('os').path.dirname(__file__), '../../public/brand/night-city.svg'),'w').write(svg)
print(len(svg))
