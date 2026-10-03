"""Audit missing exterior faces against the original roof/terrace height profile.
Never replace a building by a bounding box. Repairs are additive; original scan
bytes and preserved Blender objects are untouched. Construction stops at cutY.
"""
import json,struct,math,gzip
from pathlib import Path
from collections import defaultdict
from shapely.geometry import Polygon,box
from shapely.geometry.polygon import orient
from shapely.ops import unary_union
from shapely import constrained_delaunay_triangles
ROOT=Path(__file__).resolve().parents[1]

def polygons(g):
    if g.is_empty:return []
    if g.geom_type=='Polygon':return [g]
    return [p for q in getattr(g,'geoms',[]) for p in polygons(q)]

def analyse(b,P,cap=None):
    triangles=[[P[i+j:i+j+3] for j in (0,3,6)] for i in range(0,len(P),9)]
    roofs=[];walls=[];lo=min(v[1] for t in triangles for v in t)
    for index,t in enumerate(triangles):
        a=[t[1][i]-t[0][i] for i in range(3)];c=[t[2][i]-t[0][i] for i in range(3)]
        n=[a[1]*c[2]-a[2]*c[1],a[2]*c[0]-a[0]*c[2],a[0]*c[1]-a[1]*c[0]];length=math.sqrt(sum(x*x for x in n))
        if length<1e-7:continue
        n=[v/length for v in n]
        if abs(n[1])>.98 and min(v[1] for v in t)>lo+.08:
            poly=Polygon([(round(v[0],4),round(v[2],4)) for v in t])
            if poly.area>.001:roofs.append((sum(v[1] for v in t)/3,poly))
        elif abs(n[1])<.12:walls.append((index,t,n))
    if not roofs:raise ValueError('No horizontal roof profile for building '+str(b['id']))
    top=min(cap,max(y for y,p in roofs)) if cap is not None else max(y for y,p in roofs)
    heights=sorted(set([round(lo,3),round(top,3)]+[round(y,3) for y,p in roofs if lo+.05<y<top-.05]))
    positions=[];donors=[];segments=[];bands=[];required=missing=reversed_area=0
    for bottom,upper in zip(heights,heights[1:]):
        if upper-bottom<.04:continue
        mid=(bottom+upper)/2
        profile=unary_union([p for y,p in roofs if y>mid-.001]).buffer(0).simplify(.025,preserve_topology=True)
        band={'bottom':bottom,'top':upper,'loops':[],'requiredArea':0,'missingArea':0}
        for poly in polygons(profile):
            poly=orient(poly,1)
            band['loops'].append({'outer':list(poly.exterior.coords),'holes':[list(r.coords) for r in poly.interiors]})
            for ring in [poly.exterior,*poly.interiors]:
                coords=list(ring.coords)
                for A,B in zip(coords,coords[1:]):
                    dx,dz=B[0]-A[0],B[1]-A[1];L=math.hypot(dx,dz)
                    if L<.035:continue
                    tx,tz=dx/L,dz/L;nx,nz=tz,-tx;covered=[];backward=[];near=[]
                    for index,t,n in walls:
                        if max(v[1] for v in t)<bottom-.03 or min(v[1] for v in t)>upper+.03:continue
                        ds=[(v[0]-A[0])*nx+(v[2]-A[1])*nz for v in t]
                        if max(abs(x) for x in ds)>.085:continue
                        pp=Polygon([((v[0]-A[0])*tx+(v[2]-A[1])*tz,v[1]) for v in t])
                        if pp.area<.001:continue
                        near.append(index)
                        if n[0]*nx+n[2]*nz<-.5:backward.append(pp)
                        covered.append(pp)
                    target=box(0,bottom,L,upper);area=target.area;required+=area;band['requiredArea']+=area
                    cover=unary_union(covered).buffer(.03) if covered else Polygon()
                    gaps=target.difference(cover)
                    if backward:reversed_area+=target.intersection(unary_union(backward)).area
                    donor=min(walls,key=lambda w:(1-(w[2][0]*nx+w[2][2]*nz))*8+math.hypot(w[1][0][0]-A[0],w[1][0][2]-A[1]))[0] if walls else 0
                    fixed=0
                    for gap in polygons(gaps):
                        if gap.area<.08:continue
                        # Reject numerical seams, retaining substantive absent facade panels.
                        if gap.buffer(-.025).is_empty:continue
                        fixed+=gap.area
                        for tri in constrained_delaunay_triangles(gap).geoms:
                            uv=list(tri.exterior.coords)[:3]
                            # Positive UV area: (along,height) maps to inward normal, so reverse.
                            if (uv[1][0]-uv[0][0])*(uv[2][1]-uv[0][1])-(uv[1][1]-uv[0][1])*(uv[2][0]-uv[0][0])>0:uv.reverse()
                            for u,y in uv:positions.extend([A[0]+tx*u,y,A[1]+tz*u])
                            donors.append(donor)
                    if fixed:
                        segments.append({'a':list(A),'b':list(B),'bottom':bottom,'top':upper,'normal':[nx,0,nz],'missingArea':fixed})
                        missing+=fixed;band['missingArea']+=fixed
        bands.append(band)
    return dict(bid=b['id'],construction=cap is not None,cutY=cap,ground=lo,top=top,requiredArea=required,missingArea=missing,sourceReversedArea=reversed_area,positions=positions,donorTriangles=donors,segments=segments,profiles=bands)

def main():
    manifest=json.loads((ROOT/'evidence/construction/building_manifest.json').read_text())['sites']
    towers=json.loads((ROOT/'evidence/construction/relocated_towers.json').read_text())['towers']
    sources=json.loads((ROOT/'build/nyc.json').read_text());data=(ROOT/'build/nyc.bin').read_bytes();index={b['id']:b for b in sources['buildings']}
    target={s['roofBid']:s['cutY'] for s in manifest}
    for t in towers:target.setdefault(t['roofBid'],None)
    results=[]
    for bid,cap in target.items():
        b=index[bid];P=struct.unpack_from('<%sf'%(b['n']*9),data,b['o']);row=analyse(b,P,cap);results.append(row)
        print('BID',bid,'construction' if cap is not None else 'finished','missing',round(row['missingArea'],2),'m2','triangles',len(row['positions'])//9,'reversed',round(row['sourceReversedArea'],2),flush=True)
    out={'version':1,'method':'Original horizontal roof and terrace height profile minus existing vertical triangle coverage; additive repairs only','buildings':results}
    folder=ROOT/'evidence/construction';(folder/'facade_repairs.json').write_text(json.dumps(out,separators=(',',':')))
    with gzip.open(ROOT/'build/extra/construction_facade_repairs.json.gz','wt',encoding='utf8') as f:json.dump(out,f,separators=(',',':'))
    print('Audited',len(results),'buildings;',sum(bool(r['positions']) for r in results),'need additive exterior patches')
if __name__=='__main__':main()
