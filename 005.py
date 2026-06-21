import tkinter as tk
from tkinter import filedialog, messagebox, scrolledtext
import cv2
import numpy as np
from ultralytics import YOLO
from PIL import Image, ImageTk
import os
import threading


class YoloDetectionApp:
    def __init__(self, root):
        self.root = root
        self.root.title("YOLO 检测与图像处理工具")
        self.root.geometry("1200x800")

        # 变量初始化
        self.model = None
        self.input_folder = ""
        self.output_folder = ""
        self.image_files = []
        self.current_image_path = None

        # --- UI 布局 ---

        # 左侧面板 (控制与列表)
        self.left_panel = tk.Frame(root, width=250, bg="#f0f0f0")
        self.left_panel.pack(side=tk.LEFT, fill=tk.Y, padx=5, pady=5)

        # 按钮区域
        tk.Label(self.left_panel, text="操作面板", font=("Arial", 12, "bold"), bg="#f0f0f0").pack(pady=10)

        self.btn_load_model = tk.Button(self.left_panel, text="1. 加载模型 (.pt)", command=self.load_model, width=25,
                                        height=2)
        self.btn_load_model.pack(pady=5)

        self.btn_select_input = tk.Button(self.left_panel, text="2. 选择输入文件夹", command=self.select_input_folder,
                                          width=25, height=2)
        self.btn_select_input.pack(pady=5)

        self.btn_select_output = tk.Button(self.left_panel, text="3. 选择保存文件夹", command=self.select_output_folder,
                                           width=25, height=2)
        self.btn_select_output.pack(pady=5)

        self.btn_process_all = tk.Button(self.left_panel, text="4. 批量处理并保存所有", command=self.process_all_images,
                                         width=25, height=2, bg="#ddd")
        self.btn_process_all.pack(pady=20)

        # 文件列表
        tk.Label(self.left_panel, text="文件列表 (点击预览):", bg="#f0f0f0").pack(anchor=tk.W)
        self.file_listbox = tk.Listbox(self.left_panel, width=35)
        self.file_listbox.pack(fill=tk.Y, expand=True, pady=5)
        self.file_listbox.bind('<<ListboxSelect>>', self.on_file_select)

        # 右侧面板 (图像与日志)
        self.right_panel = tk.Frame(root)
        self.right_panel.pack(side=tk.RIGHT, fill=tk.BOTH, expand=True, padx=5, pady=5)

        # 图像显示区域
        self.image_label = tk.Label(self.right_panel, text="请加载模型并选择图片", bg="gray")
        self.image_label.pack(side=tk.TOP, fill=tk.BOTH, expand=True)

        # 底部日志区域
        self.log_text = scrolledtext.ScrolledText(self.right_panel, height=10, state='disabled')
        self.log_text.pack(side=tk.BOTTOM, fill=tk.X)

    def log(self, message):
        """向底部文本框输出日志"""
        self.log_text.config(state='normal')
        self.log_text.insert(tk.END, message + "\n")
        self.log_text.see(tk.END)
        self.log_text.config(state='disabled')
        # 同时也打印到控制台
        print(message)

    def is_edge_contrast(self, roi, point):
        """检查点是否在深浅色交替边缘"""
        y, x = point
        h, w = roi.shape
        # 检查点周围的像素值
        for dy in range(-2, 3):
            for dx in range(-2, 3):
                ny, nx = y + dy, x + dx
                if 0 <= ny < h and 0 <= nx < w:
                    # 注意：传入的roi已经是灰度图
                    val1 = int(roi[y, x])
                    val2 = int(roi[ny, nx])
                    if abs(val1 - val2) > 50:
                        return True
        return False

    def load_model(self):
        model_path = filedialog.askopenfilename(filetypes=[("YOLO Model", "*.pt")])
        if model_path:
            try:
                self.log(f"正在加载模型: {model_path} ...")
                self.model = YOLO(model_path)
                self.log("模型加载成功！")
                self.btn_load_model.config(bg="lightgreen")
            except Exception as e:
                self.log(f"模型加载失败: {e}")
                messagebox.showerror("错误", f"无法加载模型:\n{e}")

    def select_input_folder(self):
        folder = filedialog.askdirectory()
        if folder:
            self.input_folder = folder
            self.image_files = [f for f in os.listdir(folder) if f.lower().endswith(('.jpg', '.jpeg', '.png', '.bmp'))]
            self.file_listbox.delete(0, tk.END)
            for f in self.image_files:
                self.file_listbox.insert(tk.END, f)
            self.log(f"已加载 {len(self.image_files)} 张图片。")

    def select_output_folder(self):
        folder = filedialog.askdirectory()
        if folder:
            self.output_folder = folder
            self.log(f"保存路径设置为: {folder}")

    def on_file_select(self, event):
        selection = self.file_listbox.curselection()
        if selection:
            file_name = self.file_listbox.get(selection[0])
            self.current_image_path = os.path.join(self.input_folder, file_name)
            self.run_inference(self.current_image_path, save_result=False)

    def process_all_images(self):
        if not self.model:
            messagebox.showwarning("警告", "请先加载模型！")
            return
        if not self.input_folder or not self.image_files:
            messagebox.showwarning("警告", "请先选择包含图片的输入文件夹！")
            return
        if not self.output_folder:
            messagebox.showwarning("警告", "请先选择保存结果的文件夹！")
            return

        self.log("开始批量处理...")

        # 使用线程避免界面卡死
        threading.Thread(target=self._process_all_thread).start()

    def _process_all_thread(self):
        count = 0
        for file_name in self.image_files:
            img_path = os.path.join(self.input_folder, file_name)
            self.run_inference(img_path, save_result=True)
            count += 1
            # 更新UI需要回到主线程，这里简化处理，直接调用log
            # 注意：在大量循环中频繁更新UI可能会卡顿，这里仅做演示

        self.log(f"批量处理完成！共处理 {count} 张图片。")
        messagebox.showinfo("完成", f"已处理 {count} 张图片并保存至输出文件夹。")

    def run_inference(self, image_path, save_result=False):
        if self.model is None:
            self.log("请先加载模型！")
            return

        try:
            # 1. 读取图像
            img = cv2.imread(image_path)
            if img is None:
                self.log(f"无法读取图像: {image_path}")
                return

            # 备份一份用于绘图
            draw_img = img.copy()
            filename = os.path.basename(image_path)
            self.log(f"正在处理: {filename}")

            # 2. 推理
            results = self.model.predict(source=image_path, conf=0.01, iou=0.5, classes=None, agnostic_nms=False,
                                         augment=False, verbose=False)

            # 3. 处理结果逻辑 (您的核心代码)
            for result in results:
                boxes = result.boxes.cpu().numpy()

                # 按类别分组并找到每个类别的置信度最高的框
                max_conf_boxes = {}
                for box in boxes:
                    class_id = int(box.cls[0])
                    if class_id not in max_conf_boxes or box.conf[0] > max_conf_boxes[class_id]['conf']:
                        max_conf_boxes[class_id] = {
                            'box': box,
                            'conf': box.conf[0]
                        }

                for class_id, data in max_conf_boxes.items():
                    box = data['box']
                    x1, y1, x2, y2 = box.xyxy[0].astype(int)
                    confidence = box.conf[0]

                    # 绘制边界框
                    cv2.rectangle(draw_img, (x1, y1), (x2, y2), (0, 0, 255), 2)
                    label_text = f"Class {class_id}: {confidence:.2f}"
                    cv2.putText(draw_img, label_text, (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 255), 2)

                    # 提取ROI
                    roi = img[y1:y2, x1:x2]
                    if roi.size == 0: continue

                    # Class 0: 圆形检测
                    if class_id == 0:
                        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
                        gray = cv2.GaussianBlur(gray, (9, 9), 2, 2)

                        circles = cv2.HoughCircles(gray, cv2.HOUGH_GRADIENT, 1,
                                                   minDist=roi.shape[0] / 8,
                                                   param1=100, param2=30,
                                                   minRadius=10, maxRadius=0)

                        if circles is not None:
                            circles = np.round(circles[0, :]).astype("int")
                            max_circle = max(circles, key=lambda c: c[2])
                            cx, cy, r = max_circle

                            cx_original = cx + x1
                            cy_original = cy + y1
                            diameter = 2 * r

                            self.log(f"  [Class 0] 圆心: ({cx_original}, {cy_original}), 直径: {diameter}")

                            cv2.circle(draw_img, (cx_original, cy_original), r, (0, 255, 0), 2)
                            cv2.circle(draw_img, (cx_original, cy_original), 2, (0, 0, 255), 3)

                    # Class 1 or 2: 边缘点检测
                    if class_id in [1, 2]:
                        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
                        edges = cv2.Canny(gray, 50, 150)
                        edge_points = np.column_stack(np.where(edges > 0))

                        if len(edge_points) > 0:
                            center = np.array([(y2 - y1) // 2, (x2 - x1) // 2])
                            distances = np.linalg.norm(edge_points - center, axis=1)
                            closest_point = edge_points[np.argmin(distances)]

                            point = (closest_point[1] + x1, closest_point[0] + y1)

                            if self.is_edge_contrast(gray, closest_point):
                                cv2.circle(draw_img, point, 5, (0, 255, 0), -1)
                                self.log(f"  [Class {class_id}] 标记边缘点: {point}")
                            else:
                                self.log(f"  [Class {class_id}] 未找到合适的对比度边缘点")

            # 4. 显示图像 (BGR -> RGB -> ImageTk)
            # 为了在UI中显示，我们需要缩放图片适应显示区域
            if not save_result:
                self.display_image(draw_img)

            # 5. 保存结果
            if save_result and self.output_folder:
                save_path = os.path.join(self.output_folder, "processed_" + filename)
                cv2.imwrite(save_path, draw_img)
                self.log(f"  已保存至: {save_path}")

        except Exception as e:
            self.log(f"处理出错: {e}")
            import traceback
            traceback.print_exc()

    def display_image(self, cv_img):
        """将OpenCV图像转换为Tkinter可显示的图像并自适应缩放"""
        img_h, img_w = cv_img.shape[:2]

        # 获取显示区域的大小
        disp_w = self.image_label.winfo_width()
        disp_h = self.image_label.winfo_height()

        if disp_w < 10 or disp_h < 10:  # 窗口刚初始化时可能为1
            disp_w = 800
            disp_h = 600

        # 计算缩放比例
        scale = min(disp_w / img_w, disp_h / img_h)
        new_w = int(img_w * scale)
        new_h = int(img_h * scale)

        resized = cv2.resize(cv_img, (new_w, new_h))

        # 转换颜色空间 BGR -> RGB
        rgb_img = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
        pil_img = Image.fromarray(rgb_img)
        tk_img = ImageTk.PhotoImage(pil_img)

        self.image_label.config(image=tk_img, text="")
        self.image_label.image = tk_img  # 保持引用，防止被垃圾回收


if __name__ == "__main__":
    root = tk.Tk()
    app = YoloDetectionApp(root)
    root.mainloop()
