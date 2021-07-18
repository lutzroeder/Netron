#!/usr/bin/env python

import io
import json
import os
import re
import setuptools
import setuptools.command.build_py
import distutils.command.build

node_dependencies = [
    ( 'netron', [
        'node_modules/dagre/dist/dagre.js'
      ]
    )
]

class build(distutils.command.build.build):
    user_options = distutils.command.build.build.user_options + [ ('version', None, 'version' ) ]
    def initialize_options(self):
        distutils.command.build.build.initialize_options(self)
        self.version = None
    def finalize_options(self):
        distutils.command.build.build.finalize_options(self)
    def run(self):
        build_py.version = bool(self.version)
        return distutils.command.build.build.run(self)

class build_py(setuptools.command.build_py.build_py):
    user_options = setuptools.command.build_py.build_py.user_options + [ ('version', None, 'version' ) ]
    def initialize_options(self):
        setuptools.command.build_py.build_py.initialize_options(self)
        self.version = None
    def finalize_options(self):
        setuptools.command.build_py.build_py.finalize_options(self)
    def run(self):
        setuptools.command.build_py.build_py.run(self)
        for target, files in node_dependencies:
            target = os.path.join(self.build_lib, target)
            if not os.path.exists(target):
                os.makedirs(target)
            for file in files:
                self.copy_file(file, target)
        if build_py.version:
            for _, _, build_dir, filenames in self.data_files:
                for filename in filenames:
                    if filename == 'index.html':
                        filepath = os.path.join(build_dir, filename)
                        with open(filepath, 'r') as reader:
                            content = reader.read()
                        content = re.sub(r'(<meta name="version" content=")\d+.\d+.\d+(">)', r'\g<1>' + package_version() + r'\g<2>', content)
                        with open(filepath, 'w') as writer:
                            writer.write(content)
    def build_module(self, module, module_file, package):
        setuptools.command.build_py.build_py.build_module(self, module, module_file, package)
        if build_py.version and module == '__version__':
            outfile = self.get_module_outfile(self.build_lib, package.split('.'), module)
            with open(outfile, 'w+') as writer:
                writer.write("__version__ = '" + package_version() + "'\n")

def package_version():
    with open('./package.json') as reader:
        manifest = json.load(reader)
        return manifest['version']

setuptools.setup(
    name="netron",
    version=package_version(),
    description="Viewer for neural network, deep learning, and machine learning models",
    long_description='Netron is a viewer for neural network, deep learning, and machine learning models.\n\n' +
                     'Netron supports ONNX, TensorFlow Lite, Keras, Caffe, Darknet, ncnn, MNN, PaddlePaddle, Core ML, MXNet, RKNN, MindSpore Lite, TNN, Barracuda, Tengine, TensorFlow.js, Caffe2 and UFF. Netron has experimental support for PyTorch, TensorFlow, TorchScript, OpenVINO, Torch, Vitis AI, Arm NN, BigDL, Chainer, CNTK, Deeplearning4j, MediaPipe, ML.NET and scikit-learn.',
    keywords=[
        'onnx', 'keras', 'tensorflow', 'tflite', 'coreml', 'mxnet', 'caffe', 'caffe2', 'torchscript', 'pytorch', 'ncnn', 'mnn', 'openvino', 'darknet', 'paddlepaddle', 'chainer',
        'artificial intelligence', 'machine learning', 'deep learning', 'neural network',
        'visualizer', 'viewer'
    ],
    license="MIT",
    cmdclass={
        'build': build,
        'build_py': build_py
    },
    package_dir={
        'netron': 'source'
    },
    packages=[
        'netron'
    ],
    package_data={ 'netron': [ '*.*' ] },
    exclude_package_data={ 'netron': [ 'app.js', 'electron.*' ] },
    install_requires=[],
    author='Lutz Roeder',
    author_email='lutzroeder@users.noreply.github.com',
    url='https://github.com/lutzroeder/netron',
    entry_points={
        'console_scripts': [ 'netron = netron:main' ]
    },
    classifiers=[
        'Intended Audience :: Developers',
        'Intended Audience :: Education',
        'Intended Audience :: Science/Research',
        'Programming Language :: Python :: 2',
        'Programming Language :: Python :: 2.7',
        'Programming Language :: Python :: 3',
        'Programming Language :: Python :: 3.6',
        'Topic :: Software Development',
        'Topic :: Software Development :: Libraries',
        'Topic :: Software Development :: Libraries :: Python Modules',
        'Topic :: Scientific/Engineering',
        'Topic :: Scientific/Engineering :: Mathematics',
        'Topic :: Scientific/Engineering :: Artificial Intelligence',
        'Topic :: Scientific/Engineering :: Visualization'
    ],
    options={
        'build': {
            'build_base': './dist',
            'build_lib': './dist/lib'
        },
        'bdist_wheel': {
            'universal': 1,
            'dist_dir': './dist/dist'
        },
        'egg_info': {
            'egg_base': './dist'
        }
    }
)
