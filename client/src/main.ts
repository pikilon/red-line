import { Color, Scene, WebGLRenderer } from "three";
import { createIsometricCamera } from "./camera";

const container = document.getElementById("app");
if (!container) throw new Error("Missing #app container");

const renderer = new WebGLRenderer({ antialias: true });
const scene = new Scene();
scene.background = new Color(0x101820);
const camera = createIsometricCamera(1);

function resize(): void {
  const { clientWidth: width, clientHeight: height } = container as HTMLElement;
  renderer.setSize(width, height);
  const aspect = width / Math.max(height, 1);
  const halfHeight = (camera.top - camera.bottom) / 2;
  camera.left = -halfHeight * aspect;
  camera.right = halfHeight * aspect;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
}

container.appendChild(renderer.domElement);
window.addEventListener("resize", resize);
resize();
