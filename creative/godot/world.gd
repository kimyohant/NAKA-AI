extends Node3D

var world: Node3D
var camera: Camera3D
var key: DirectionalLight3D
var fill: DirectionalLight3D
var env: Environment
var elapsed := 0.0
var poll_time := 0.0
var chapter := 0.0
var pointer := 0.0
var paused := false
var chapter_colors := [Color("83a8ff"),Color("ffe3ba"),Color("b8e7e0"),Color("eac491"),Color("9db9ff")]

func _ready() -> void:
	get_viewport().transparent_bg = true
	world = preload("res://naka-world.glb").instantiate()
	add_child(world)
	var environment_node := WorldEnvironment.new()
	env = Environment.new()
	env.background_mode = Environment.BG_CLEAR_COLOR
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color("a7b7df")
	env.ambient_light_energy = 0.65
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	environment_node.environment = env
	add_child(environment_node)
	key = DirectionalLight3D.new()
	key.rotation_degrees = Vector3(-48,-30,0)
	key.light_energy = 1.7
	key.shadow_enabled = true
	add_child(key)
	fill = DirectionalLight3D.new()
	fill.rotation_degrees = Vector3(-25,140,0)
	fill.light_color = Color("729eff")
	fill.light_energy = 1.1
	add_child(fill)
	camera = Camera3D.new()
	camera.projection = Camera3D.PROJECTION_ORTHOGONAL
	camera.size = 8.4
	add_child(camera)
	camera.position = Vector3(6.5,7.2,11)
	camera.look_at(Vector3(0,1.6,0))
	if OS.has_feature("web"):
		JavaScriptBridge.eval("window.parent.postMessage({type:'naka-world-ready'},window.location.origin)")

func _process(delta: float) -> void:
	poll_time += delta
	if OS.has_feature("web") and poll_time > 0.1:
		poll_time = 0
		var raw = JavaScriptBridge.eval("JSON.stringify(window.parent.nakaSceneState || {})")
		if raw is String:
			var state = JSON.parse_string(raw)
			if state is Dictionary:
				chapter = float(state.get("chapter",0))
				pointer = float(state.get("pointer",0))
				paused = bool(state.get("paused",false))
	if not paused:
		elapsed += delta
	var index := clampi(int(chapter),0,4)
	key.light_color = key.light_color.lerp(chapter_colors[index],delta*2)
	var target_angle := 0.0 if paused else (chapter * 0.12 + pointer * 0.06)
	world.rotation.y = lerp_angle(world.rotation.y,target_angle,minf(delta*2.5,1))
	key.light_energy = lerpf(key.light_energy,1.7 if index == 0 or index == 4 else 2.4,delta)
