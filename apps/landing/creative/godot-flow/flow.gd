extends Node2D

const WIDTH := 900.0
const HEIGHT := 560.0
const NAVY := Color("0a1d43")
const BLUE := Color("235be8")
const CYAN := Color("7ddaff")
const WHITE := Color("f8fbff")

var elapsed := 0.0
var poll_elapsed := 0.0
var current_phase := 0
var visual_phase := 0.0
var paused := false
var naka: Sprite2D
var product: Sprite2D
var output_labels: Array[Label] = []

func _ready() -> void:
	product = Sprite2D.new()
	product.texture = preload("res://product.png")
	product.scale = Vector2(0.17, 0.17)
	product.position = Vector2(176, 306)
	add_child(product)

	naka = Sprite2D.new()
	naka.texture = preload("res://naka.png")
	naka.scale = Vector2(0.29, 0.29)
	naka.position = Vector2(456, 308)
	add_child(naka)

	var names := ["CLIP", "LIVE", "REPLY"]
	for index in range(3):
		var label := Label.new()
		label.text = names[index]
		label.position = Vector2(724, 128 + index * 138)
		label.add_theme_color_override("font_color", Color("173763"))
		label.add_theme_font_size_override("font_size", 26)
		add_child(label)
		output_labels.append(label)

	if OS.has_feature("web"):
		JavaScriptBridge.eval("window.parent.postMessage({type:'naka-flow-ready'}, window.location.origin)")

func _process(delta: float) -> void:
	var previous_phase := visual_phase
	poll_elapsed += delta
	if OS.has_feature("web") and poll_elapsed > 0.12:
		poll_elapsed = 0.0
		var raw = JavaScriptBridge.eval("JSON.stringify(window.parent.nakaFlowState || {})")
		if raw is String:
			var state = JSON.parse_string(raw)
			if state is Dictionary:
				current_phase = clampi(int(state.get("phase", 0)), 0, 2)
				paused = bool(state.get("paused", false))
	if not paused:
		elapsed += delta
		visual_phase = lerpf(visual_phase, float(current_phase), minf(delta * 4.0, 1.0))
	else:
		visual_phase = float(current_phase)
	Engine.max_fps = 5 if paused else 30
	naka.position = Vector2(456, 308 + sin(elapsed * 1.4) * 5.0)
	naka.rotation = sin(elapsed * 1.1) * 0.018
	product.position = Vector2(176 + sin(elapsed * 1.0) * 3.0, 306)
	for index in range(output_labels.size()):
		output_labels[index].modulate.a = 0.55 if visual_phase < 1.4 else 1.0
	if not paused or not is_equal_approx(previous_phase, visual_phase):
		queue_redraw()

func _panel(rect: Rect2, color: Color, radius: int = 24) -> void:
	var style := StyleBoxFlat.new()
	style.bg_color = color
	style.set_corner_radius_all(radius)
	draw_style_box(style, rect)

func _draw() -> void:
	draw_rect(Rect2(0, 0, WIDTH, HEIGHT), NAVY)
	draw_circle(Vector2(450, 280), 280, Color("103469"))
	draw_circle(Vector2(450, 280), 222, Color("174481"))
	for ring in range(3):
		draw_arc(Vector2(450, 280), 185.0 + ring * 23.0, -0.5, 2.6, 80, Color(0.36, 0.64, 1.0, 0.17), 2.0, true)

	var product_emphasis := 0.46 if visual_phase > 0.6 else 0.9
	_panel(Rect2(43, 151, 267, 300), Color(0.7, 0.85, 1.0, product_emphasis * 0.3), 27)
	_panel(Rect2(53, 161, 247, 280), Color("f8fbff"), 20)
	_panel(Rect2(70, 180, 212, 215), Color("e9edf1"), 12)
	_panel(Rect2(97, 402, 158, 17), Color("d6e3f3"), 8)
	draw_circle(Vector2(285, 152), 16, BLUE)
	draw_circle(Vector2(285, 152), 6, WHITE)

	var bridge_alpha := 0.26 if visual_phase < 0.5 else 0.75
	draw_line(Vector2(299, 298), Vector2(345, 298), Color(0.59, 0.86, 1.0, bridge_alpha), 4.0, true)
	draw_line(Vector2(595, 298), Vector2(640, 298), Color(0.59, 0.86, 1.0, bridge_alpha), 4.0, true)
	for index in range(4):
		var travel := fmod(elapsed * 0.55 + float(index) * 0.25, 1.0)
		draw_circle(Vector2(302 + travel * 43.0, 298), 3.0 + index % 2, Color(0.49, 0.86, 1.0, bridge_alpha))
		draw_circle(Vector2(598 + travel * 40.0, 298), 3.0 + index % 2, Color(0.49, 0.86, 1.0, bridge_alpha))

	for index in range(3):
		var active := visual_phase > 1.35
		var card_alpha := 1.0 if active else 0.76
		var y := 70.0 + index * 138.0
		_panel(Rect2(647, y, 212, 113), Color(0.5, 0.8, 1.0, 0.24 if active else 0.1), 20)
		_panel(Rect2(653, y + 5, 200, 101), Color(0.98, 0.99, 1.0, card_alpha), 16)
		_panel(Rect2(677, y + 28, 31, 31), BLUE if index == 0 else Color("2574bf"), 9)
		if index == 0:
			var points := PackedVector2Array([Vector2(689, y + 36), Vector2(689, y + 52), Vector2(701, y + 44)])
			draw_colored_polygon(points, WHITE)
		elif index == 1:
			draw_circle(Vector2(692, y + 43), 6, Color("ff7993"))
		else:
			for dot in range(3):
				draw_circle(Vector2(683 + dot * 9, y + 44), 2, WHITE)
		_panel(Rect2(724, y + 68, 95, 7), Color("d9e6f6"), 3)
		_panel(Rect2(724, y + 82, 69, 7), Color("e7eef8"), 3)

	if visual_phase > 0.45:
		for index in range(7):
			var angle := elapsed * 0.72 + float(index) * TAU / 7.0
			var orbit := Vector2(456 + cos(angle) * 192.0, 284 + sin(angle) * 190.0)
			draw_circle(orbit, 3.0 + float(index % 3), Color(0.62, 0.89, 1.0, 0.7))
