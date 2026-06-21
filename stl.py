import sys
import os
import pyvista as pv
from PyQt5 import QtWidgets, QtCore
from pyvistaqt import QtInteractor
class XRaySimulator(QtWidgets.QMainWindow):
    def __init__(self):
        super().__init__()

        # 1. 基础窗口设置
        self.setWindowTitle("多部件虚拟 X 射线工具 (Python版)")
        self.resize(1200, 800)

        self.frame = QtWidgets.QFrame()
        self.setCentralWidget(self.frame)
        self.layout = QtWidgets.QHBoxLayout()
        self.frame.setLayout(self.layout)
        # 2. 3D 视图区域 (左侧)
        self.plotter = QtInteractor(self.frame)
        self.layout.addWidget(self.plotter.interactor, stretch=4)
        # 初始化场景：黑色背景，开启深度剥离(透明度叠加关键)
        self.plotter.set_background("black")
        self.plotter.enable_depth_peeling()
        # 3. 数据管理
        # 字典结构: {'文件名': actor对象, ...}
        self.actors = {}
        # 4. 控制面板 (右侧)
        self.controls_layout = QtWidgets.QVBoxLayout()
        self.layout.addLayout(self.controls_layout, stretch=1)

        self.create_controls()

    def create_controls(self):
        # --- A. 文件操作 ---
        group_file = QtWidgets.QGroupBox("1. 文件导入")
        layout_file = QtWidgets.QVBoxLayout()

        self.btn_load = QtWidgets.QPushButton("导入 STL (支持多选)")
        self.btn_load.setStyleSheet("background-color: #d1e7dd; padding: 5px;")
        self.btn_load.clicked.connect(self.import_files)
        layout_file.addWidget(self.btn_load)

        self.btn_clear = QtWidgets.QPushButton("清空场景")
        self.btn_clear.clicked.connect(self.clear_scene)
        layout_file.addWidget(self.btn_clear)

        self.btn_screenshot = QtWidgets.QPushButton("保存截图")
        self.btn_screenshot.clicked.connect(self.save_screenshot)
        layout_file.addWidget(self.btn_screenshot)

        group_file.setLayout(layout_file)
        self.controls_layout.addWidget(group_file)

        # --- B. 对象选择 (核心修改) ---
        group_sel = QtWidgets.QGroupBox("2. 操作对象选择")
        layout_sel = QtWidgets.QVBoxLayout()

        self.combo_target = QtWidgets.QComboBox()
        self.combo_target.addItem("== 全部模型 (整体移动) ==")
        # 当下拉菜单变化时，记录当前选中项，不需额外信号，读取时直接获取即可
        layout_sel.addWidget(self.combo_target)

        group_sel.setLayout(layout_sel)
        self.controls_layout.addWidget(group_sel)

        # --- C. 移动控制 (Translation) ---
        group_move = QtWidgets.QGroupBox("3. 平移 (上下左右)")
        layout_move = QtWidgets.QGridLayout()

        self.spin_step = QtWidgets.QDoubleSpinBox()
        self.spin_step.setRange(0.1, 100.0)
        self.spin_step.setValue(5.0)
        self.spin_step.setPrefix("步长: ")
        self.spin_step.setSuffix(" mm")
        layout_move.addWidget(self.spin_step, 0, 0, 1, 3)

        # 按钮布局
        btn_up = QtWidgets.QPushButton("上 (+Y)")
        btn_down = QtWidgets.QPushButton("下 (-Y)")
        btn_left = QtWidgets.QPushButton("左 (-X)")
        btn_right = QtWidgets.QPushButton("右 (+X)")
        btn_in = QtWidgets.QPushButton("前 (+Z)")
        btn_out = QtWidgets.QPushButton("后 (-Z)")

        # 绑定事件 (使用 lambda 传递参数)
        btn_up.clicked.connect(lambda: self.translate_target(0, 1, 0))
        btn_down.clicked.connect(lambda: self.translate_target(0, -1, 0))
        btn_left.clicked.connect(lambda: self.translate_target(-1, 0, 0))
        btn_right.clicked.connect(lambda: self.translate_target(1, 0, 0))
        btn_in.clicked.connect(lambda: self.translate_target(0, 0, 1))
        btn_out.clicked.connect(lambda: self.translate_target(0, 0, -1))

        layout_move.addWidget(btn_up, 1, 1)
        layout_move.addWidget(btn_left, 2, 0)
        layout_move.addWidget(btn_right, 2, 2)
        layout_move.addWidget(btn_down, 3, 1)
        layout_move.addWidget(btn_in, 4, 0)
        layout_move.addWidget(btn_out, 4, 2)

        group_move.setLayout(layout_move)
        self.controls_layout.addWidget(group_move)

        # --- D. 旋转控制 (Rotation) ---
        group_rot = QtWidgets.QGroupBox("4. 旋转")
        layout_rot = QtWidgets.QVBoxLayout()

        self.lbl_rot_hint = QtWidgets.QLabel("提示: 选'全部'时旋转视角\n选'单个'时旋转物体")
        self.lbl_rot_hint.setStyleSheet("color: gray; font-size: 10px;")
        layout_rot.addWidget(self.lbl_rot_hint)

        layout_rot_btns = QtWidgets.QHBoxLayout()
        btn_rot_cw = QtWidgets.QPushButton("顺时针 90°")
        btn_rot_ccw = QtWidgets.QPushButton("逆时针 90°")

        btn_rot_cw.clicked.connect(lambda: self.rotate_target(90))
        btn_rot_ccw.clicked.connect(lambda: self.rotate_target(-90))

        layout_rot_btns.addWidget(btn_rot_ccw)
        layout_rot_btns.addWidget(btn_rot_cw)
        layout_rot.addLayout(layout_rot_btns)

        btn_reset = QtWidgets.QPushButton("重置视角 (Reset View)")
        btn_reset.clicked.connect(self.reset_view)
        layout_rot.addWidget(btn_reset)

        group_rot.setLayout(layout_rot)
        self.controls_layout.addWidget(group_rot)

        # --- E. 显影强度 ---
        group_view = QtWidgets.QGroupBox("5. 显影强度 (Opacity)")
        layout_view = QtWidgets.QVBoxLayout()
        self.slider_opacity = QtWidgets.QSlider(QtCore.Qt.Horizontal)
        self.slider_opacity.setRange(1, 100)
        self.slider_opacity.setValue(40)
        self.slider_opacity.valueChanged.connect(self.update_opacity)
        layout_view.addWidget(self.slider_opacity)
        group_view.setLayout(layout_view)
        self.controls_layout.addWidget(group_view)

        self.controls_layout.addStretch()

    # --- 核心功能实现 ---

    def import_files(self):
        # 允许选择多个文件
        filenames, _ = QtWidgets.QFileDialog.getOpenFileNames(
            self, "选择 STL 文件 (可多选)", "", "STL Files (*.stl);;All Files (*)"
        )

        if filenames:
            for filepath in filenames:
                name = os.path.basename(filepath)
                if name in self.actors:
                    print(f"跳过重复文件: {name}")
                    continue

                try:
                    mesh = pv.read(filepath)
                    # 关键渲染设置：Lighting=False, Opacity=0.4
                    opacity_val = self.slider_opacity.value() / 100.0
                    actor = self.plotter.add_mesh(
                        mesh,
                        color="white",
                        opacity=opacity_val,
                        lighting=False,
                        show_edges=False,
                        smooth_shading=True,
                        name=name  # 设置内部名称
                    )

                    # 存入字典
                    self.actors[name] = actor
                    # 添加到下拉菜单
                    self.combo_target.addItem(name)

                except Exception as e:
                    print(f"无法加载 {name}: {e}")

            self.plotter.reset_camera()
            self.status_msg(f"已加载 {len(filenames)} 个文件")

    def get_selected_actors(self):
        """
        根据下拉菜单，返回需要操作的 Actor 列表。
        返回: (actors_list, is_global_mode)
        """
        current_text = self.combo_target.currentText()

        # 判断是否选择的是“全部”
        if "== 全部模型" in current_text:
            return list(self.actors.values()), True
        else:
            # 如果是单个文件，从字典里取出来放进列表
            if current_text in self.actors:
                return [self.actors[current_text]], False
        return [], False

    def translate_target(self, dx, dy, dz):
        """
        移动逻辑
        """
        targets, is_global = self.get_selected_actors()
        step = self.spin_step.value()

        if not targets:
            return

        # 计算实际位移量
        vec = [dx * step, dy * step, dz * step]

        for actor in targets:
            # PyVista 的 actor.position 是属性，可以直接修改
            # 获取旧位置
            old_pos = actor.position
            # 设置新位置
            actor.position = (old_pos[0] + vec[0], old_pos[1] + vec[1], old_pos[2] + vec[2])

        self.plotter.render()
        mode_str = "整体" if is_global else "单独"
        print(f"{mode_str}平移: {vec}")

    def rotate_target(self, angle):
        """
        旋转逻辑：
        - Global: 旋转相机 (模拟转动检查设备/患者整体)
        - Individual: 旋转物体 (模拟复位骨头)
        """
        targets, is_global = self.get_selected_actors()

        if is_global:
            # 整体旋转 -> 旋转相机 (View)
            # roll 是绕视线轴旋转，azimuth 是绕垂直轴
            self.plotter.camera.roll += angle
            self.status_msg(f"整体视角旋转 {angle}°")
        else:
            # 单个旋转 -> 旋转 Actor
            # 默认绕 Z 轴旋转 (在 2D 视图下最明显)
            for actor in targets:
                actor.RotateZ(angle)  # 也可以改成 RotateX / RotateY
            self.status_msg(f"物体旋转 {angle}°")

        self.plotter.render()

    def update_opacity(self):
        # 统一调整所有物体的透明度
        val = self.slider_opacity.value() / 100.0
        for actor in self.actors.values():
            actor.GetProperty().SetOpacity(val)
        self.plotter.render()

    def clear_scene(self):
        self.plotter.clear()
        self.actors.clear()
        self.combo_target.clear()
        self.combo_target.addItem("== 全部模型 (整体移动) ==")
        self.plotter.set_background("black")
        self.status_msg("场景已清空")

    def reset_view(self):
        self.plotter.view_xy()
        self.plotter.reset_camera()

    def save_screenshot(self):
        filename, _ = QtWidgets.QFileDialog.getSaveFileName(
            self, "保存图片", "xray_combined.png", "Images (*.png *.jpg)"
        )
        if filename:
            self.plotter.screenshot(filename)
            self.status_msg(f"截图已保存: {filename}")

    def status_msg(self, msg):
        print(msg)
        self.setWindowTitle(f"多部件虚拟 X 射线工具 - {msg}")


if __name__ == "__main__":
    app = QtWidgets.QApplication(sys.argv)
    window = XRaySimulator()
    window.show()
    sys.exit(app.exec_())
