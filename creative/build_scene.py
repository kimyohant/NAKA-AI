"""Rebuild Naka's original miniature shop in Blender, export to Godot/glTF."""
import bpy, math, os, random
from mathutils import Vector
random.seed(19)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
def material(name, color, metallic=0, emission=0):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Metallic'].default_value=metallic; p.inputs['Roughness'].default_value=.32
    if emission:
        p.inputs['Emission Color'].default_value=(*color,1); p.inputs['Emission Strength'].default_value=emission
    return m
pearl=material('Porcelain',(.82,.88,1),.15)
blue=material('Cobalt enamel',(.025,.13,.55),.3)
navy=material('Midnight visor',(.009,.025,.085),.4)
cyan=material('Naka light',(.1,.75,1),.15,2)
gold=material('Warm brass',(.95,.57,.19),.55)
window=material('Shop light',(1,.63,.23),0,2)
stone=material('Island stone',(.12,.2,.36),.1)
tile=material('Floor porcelain',(.31,.43,.62))
leaf=material('Blue jade',(.04,.32,.38),.1)
wood=material('Warm timber',(.31,.16,.08))
def finish(o,name,mat):
    o.name=name; o.data.materials.append(mat)
    return o
def cube(name,loc,scale,mat,bevel=.08):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc); o=bpy.context.object; o.scale=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        mod=o.modifiers.new('Soft crafted edges','BEVEL'); mod.width=bevel; mod.segments=3
        bpy.context.view_layer.objects.active=o; bpy.ops.object.modifier_apply(modifier=mod.name)
        o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
    return finish(o,name,mat)
def sphere(name,loc,scale,mat):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=20,location=loc)
    o=bpy.context.object; o.scale=scale
    for p in o.data.polygons:p.use_smooth=True
    return finish(o,name,mat)
def tube(name,points,radius,mat):
    c=bpy.data.curves.new(name,'CURVE'); c.dimensions='3D'; c.resolution_u=16;c.bevel_depth=radius;c.bevel_resolution=4
    s=c.splines.new('BEZIER');s.bezier_points.add(len(points)-1)
    for b,p in zip(s.bezier_points,points):b.co=p;b.handle_left_type='AUTO';b.handle_right_type='AUTO'
    o=bpy.data.objects.new(name,c);bpy.context.collection.objects.link(o);o.data.materials.append(mat);return o
def cone(name,loc,r1,r2,depth,mat):
    bpy.ops.mesh.primitive_cone_add(vertices=32,radius1=r1,radius2=r2,depth=depth,location=loc)
    return finish(bpy.context.object,name,mat)
# An island with an inlaid river, a boutique, and the naga as its shop companion.
cube('Floating island',(0,0,-.23),(6.6,5.3,.48),stone,.25)
cube('Porcelain terrace',(0,0,.035),(6.45,5.15,.14),tile,.21)
for x in [-2.8,-1.95,-1.1,-.25,.6,1.45,2.3]:
    cube('Terrace joint',(x,0,.111),(.014,4.9,.008),stone,.001)
for y in [-2,-1.15,-.3,.55,1.4,2.25]:cube('Terrace joint',(0,y,.112),(6.2,.014,.008),stone,.001)
tube('River of ideas',[(-3,-1.75,.15),(-1.7,-1.4,.15),(-.4,-1.7,.15),(1.2,-2,.15),(2.9,-1.35,.15)],.065,cyan)
# Thai boutique with a sweeping double roof.
cube('Shop walls',(-1.15,.7,1.2),(2.3,2,2.2),pearl,.16)
cube('Shop foundation',(-1.15,.7,.23),(2.6,2.3,.24),blue)
for x in [-2.12,-.18]:
    cube('Shop front pillar',(x,-.39,1.22),(.12,.16,2.15),gold,.025)
cube('Shop door',(-1.15,-.335,.95),(.73,.08,1.65),blue,.15)
cube('Door glass',(-1.15,-.39,1.2),(.49,.055,.9),window,.11)
sphere('Door handle',(-.88,-.45,.75),(.035,.035,.035),gold)
for x in [-1.97,-.33]:
    cube('Window brass',(x,-.345,1.36),(.49,.1,.8),gold,.08)
    cube('Window glow',(x,-.41,1.36),(.38,.05,.68),window,.065)
    cube('Window mullion',(x,-.45,1.36),(.045,.05,.7),blue,.01)
for side in [-1,1]:
    for i in range(12):
        y=-.56+i*.225
        tube('Cobalt roof tile', [(-1.15,y,3.15),(-1.15+side*.55,y,2.93),(-1.15+side*1.05,y,2.58),(-1.15+side*1.48,y,2.65)],.15,blue)
    for y in [-.69,2.03]:
        tube('Thai roof edge',[(-1.15,y,3.22),(-1.15+side*.6,y,3),(-1.15+side*1.1,y,2.66),(-1.15+side*1.55,y,2.73),(-1.15+side*1.7,y,3.02)],.07,gold)
tube('Ridge',[(-1.15,-.72,3.25),(-1.15,.7,3.25),(-1.15,2.12,3.25)],.09,pearl)
cube('Shop sign',(-1.15,-.54,2.17),(1.5,.18,.35),navy,.08)
font=bpy.data.curves.new('NAKA sign type','FONT');font.body='NAKA';font.align_x='CENTER';font.size=.24;font.extrude=.007
ob=bpy.data.objects.new('NAKA shop sign',font);bpy.context.collection.objects.link(ob);ob.location=(-1.15,-.643,2.09);ob.rotation_euler=(math.pi/2,0,0);font.materials.append(pearl)
for i in range(3):cube('Shop steps',(-1.15,-.68-i*.2,.2-i*.045),(1.05,.24,.16),pearl,.03)
# Coiled, legless robotic naga. Blue core and porcelain armor follow the same silhouette.
body=[(2.46,.62,.48),(2.35,1.15,.58),(1.66,1.4,.47),(.83,.9,.43),(.68,.03,.47),(1.17,-.63,.5),(2.11,-.57,.62),(2.38,.02,.8),(1.99,.37,1.01),(1.37,.08,1.22),(1.23,-.12,1.8),(1.48,-.18,2.24)]
tube('Naga cobalt body',body,.32,blue)
tube('Naga pearl spine',[(x,y-.21,z+.15) for x,y,z in body],.17,pearl)
tube('Naga raised tail',[(2.46,.62,.48),(2.75,1.1,.8),(2.85,1.37,1.3),(2.62,1.4,1.65)],.17,blue)
tube('Tail flame',[(2.62,1.4,1.61),(2.72,1.42,1.97),(2.57,1.4,2.23)],.095,cyan)
sphere('Naga pearl head',(1.48,-.2,2.28),(.65,.5,.49),pearl)
sphere('Naga face',(1.48,-.586,2.28),(.51,.16,.32),navy)
for x in [1.23,1.7]:sphere('Kind cyan eye',(x,-.733,2.29),(.066,.036,.135),cyan)
for x in [.86,2.1]:
    sphere('Ear porcelain',(x,-.11,2.27),(.12,.24,.25),pearl)
    sphere('Ear blue ring',(x,-.18,2.28),(.13,.17,.17),blue)
    sphere('Ear light',(x,-.21,2.28),(.135,.10,.105),cyan)
for i in range(3):
    x=1.1+i*.34
    tube('Swept crest',[(x,-.22,2.56),(x+.05,-.03,2.91),(x+.2,.21,3.28+(i==1)*.22)],.12,pearl)
    tube('Crest light',[(x+.07,-.14,2.64),(x+.13,.02,2.94),(x+.2,.21,3.28+(i==1)*.22)],.065,cyan)
# Parcels and a jade tree complete the miniature world.
for x,y,s in [(-2.53,-1.12,.42),(-2.47,-.63,.32),(-2.58,-1.63,.28),(.0,-1.35,.35)]:
    cube('Parcel',(x,y,.12+s/2),(s,s,s),gold,.035)
    cube('Parcel ribbon',(x,y,.13+s),(.065,s+.01,.016),pearl,.003)
    cube('Parcel ribbon front',(x,y-s/2-.005,.12+s/2),(.065,.015,s),pearl,.003)
tube('Jade tree trunk',[(2.25,1.9,.1),(2.2,1.85,1),(2.37,1.8,1.7)],.11,wood)
for x,y,z,s in [(2.37,1.8,2.03,.46),(2.02,1.81,1.7,.4),(2.68,1.88,1.76,.4),(2.35,1.69,1.5,.36)]:sphere('Jade foliage',(x,y,z),(s,s,s),leaf)
for x,y in [(-2.85,1.7),(2.7,-1.9),(.0,2.17)]:
    cone('Planter',(x,y,.3),.2,.26,.38,pearl)
    for i in range(4):
        a=i*math.pi/2;tube('Plant',[(x,y,.45),(x+math.cos(a)*.12,y+math.sin(a)*.12,.72),(x+math.cos(a)*.19,y+math.sin(a)*.19,.77)],.055,leaf)
for x,y in [(-2.9,-2.12),(2.94,-2.12)]:
    cube('Lantern foot',(x,y,.19),(.26,.26,.15),blue,.03)
    cube('Lantern',(x,y,.44),(.2,.2,.38),window,.04)
    cube('Lantern cap',(x,y,.66),(.32,.32,.08),gold,.035)
# Give the naga the leading role in the optional Godot model. The boutique
# recedes while a real product visibly becomes a clip and a customer reply.
from mathutils import Matrix
for obj in list(bpy.context.scene.objects):
    name=obj.name
    if name.startswith(('Jade tree','Jade foliage','Plant','Planter','Lantern')):
        bpy.data.objects.remove(obj,do_unlink=True)
        continue
    if name.startswith(('Shop','Door','Window','Cobalt roof','Thai roof','Ridge','NAKA shop')):
        pivot=Vector((-1.15,.7,1.0))
        obj.matrix_world=Matrix.Translation(pivot) @ Matrix.Scale(.78,4) @ Matrix.Translation(-pivot) @ obj.matrix_world
    if name.startswith(('Naga','Tail','Kind cyan','Ear','Swept','Crest')):
        pivot=Vector((1.55,0,1.1))
        obj.matrix_world=Matrix.Translation(pivot) @ Matrix.Scale(1.28,4) @ Matrix.Translation(-pivot) @ obj.matrix_world

cube('Sales product pedestal',(-.45,-1.25,.35),(.9,.8,.48),pearl,.11)
cube('Sales product bottle',(-.45,-1.25,.95),(.3,.3,.72),pearl,.08)
cube('Sales product cap',(-.45,-1.25,1.35),(.23,.23,.13),gold,.025)
cube('Sales product label',(-.45,-1.415,.96),(.29,.015,.18),blue,.01)
cube('Sales clip phone',(-1.75,-1.35,2.13),(.76,.1,1.26),navy,.09)
cube('Sales clip screen',(-1.75,-1.41,2.13),(.66,.012,1.12),blue,.07)
tri=bpy.data.meshes.new('Play triangle mesh')
tri.from_pydata([(-1.84,-1.432,1.98),(-1.84,-1.432,2.28),(-1.59,-1.432,2.13)],[],[(0,1,2)])
play=bpy.data.objects.new('Sales clip play',tri);bpy.context.collection.objects.link(play);tri.materials.append(pearl)
cube('Sales chat card',(.05,-1.16,3.36),(1.13,.1,.54),blue,.09)
for i,w in enumerate([.72,.52]):
    cube('Sales chat reply',(-.1,-1.225,3.44-i*.18),(w,.012,.055),pearl,.015)
tube('Sales content flow',[(-.45,-1.65,1.34),(-.88,-1.72,1.72),(-1.4,-1.5,2.04)],.025,cyan)
tube('Sales reply flow',[(-.45,-1.65,1.34),(.1,-1.45,2.18),(.05,-1.3,3.08)],.02,cyan)
# Export only geometry; Godot owns camera, live lights, and transitions.
os.makedirs(os.path.join(ROOT,'creative/godot'),exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.convert(target='MESH')
bpy.ops.export_scene.gltf(filepath=os.path.join(ROOT,'creative/godot/naka-world.glb'),export_format='GLB',use_selection=True)
scene=bpy.context.scene
scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
scene.world.color=(.16,.16,.16)
def area(name,loc,power,color,size):
    d=bpy.data.lights.new(name,'AREA');d.energy=power;d.color=color;d.shape='DISK';d.size=size
    o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o);o.location=loc;o.rotation_euler=(Vector((0,0,1))-o.location).to_track_quat('-Z','Y').to_euler()
area('Moon key',(1,-4,8),1100,(.57,.72,1),7)
area('Warm shop',(-4,-2,4),850,(1,.67,.4),5)
area('Blue rim',(3,5,6),1600,(.2,.5,1),4)
bpy.ops.object.camera_add(location=(8,-12,8));cam=bpy.context.object;cam.rotation_euler=(Vector((0,0,1.25))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=10.8;scene.camera=cam
scene.render.resolution_x=1500;scene.render.resolution_y=1300;scene.render.resolution_percentage=100
scene.render.film_transparent=True
scene.render.image_settings.file_format='PNG';scene.render.filepath=os.path.join(ROOT,'public/assets/naka-world.png')
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT,'creative/naka-world.blend'))
bpy.ops.render.render(write_still=True)
