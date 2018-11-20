#!/usr/bin/env python

import distutils
import io
import json
import os
import setuptools
import setuptools.command.build_py
import distutils.command.build

node_dependencies = [ 
    ( 'netron', [
        'node_modules/d3/dist/d3.min.js',
        'node_modules/lodash/lodash.min.js',
        'node_modules/dagre/dist/dagre.min.js',
        'node_modules/handlebars/dist/handlebars.min.js',
        'node_modules/marked/marked.min.js',
        'node_modules/pako/dist/pako.min.js',
        'node_modules/protobufjs/dist/protobuf.min.js',
        'node_modules/flatbuffers/js/flatbuffers.js',
        'node_modules/npm-font-open-sans/open-sans.css' ]),
    ( 'netron/fonts/Regular', [
        'node_modules/npm-font-open-sans/fonts/Regular/OpenSans-Regular.eot',
        'node_modules/npm-font-open-sans/fonts/Regular/OpenSans-Regular.svg',
        'node_modules/npm-font-open-sans/fonts/Regular/OpenSans-Regular.ttf',
        'node_modules/npm-font-open-sans/fonts/Regular/OpenSans-Regular.woff',
        'node_modules/npm-font-open-sans/fonts/Regular/OpenSans-Regular.woff2' ]),
    ( 'netron/fonts/Semibold', [
        'node_modules/npm-font-open-sans/fonts/Semibold/OpenSans-Semibold.eot',
        'node_modules/npm-font-open-sans/fonts/Semibold/OpenSans-Semibold.svg',
        'node_modules/npm-font-open-sans/fonts/Semibold/OpenSans-Semibold.ttf',
        'node_modules/npm-font-open-sans/fonts/Semibold/OpenSans-Semibold.woff',
        'node_modules/npm-font-open-sans/fonts/Semibold/OpenSans-Semibold.woff2' ]),
    ( 'netron/fonts/Bold', [
        'node_modules/npm-font-open-sans/fonts/Bold/OpenSans-Bold.eot',
        'node_modules/npm-font-open-sans/fonts/Bold/OpenSans-Bold.svg',
        'node_modules/npm-font-open-sans/fonts/Bold/OpenSans-Bold.ttf',
        'node_modules/npm-font-open-sans/fonts/Bold/OpenSans-Bold.woff',
        'node_modules/npm-font-open-sans/fonts/Bold/OpenSans-Bold.woff2' ])
]

class build(distutils.command.build.build):
    user_options = distutils.command.build.build.user_options + [ ('version', None, 'version' ) ]
    def initialize_options(self):
        distutils.command.build.build.initialize_options(self)
        self.version = None
    def finalize_options(self):
        distutils.command.build.build.finalize_options(self)
    def run(self):
        if self.version:
            build_py.version = True;
        else:
            build_py.version = False;
        return distutils.command.build.build.run(self)

class build_py(setuptools.command.build_py.build_py):
    user_options = setuptools.command.build_py.build_py.user_options + [ ('version', None, 'version' ) ]
    def initialize_options(self):
        setuptools.command.build_py.build_py.initialize_options(self)
        self.version = None
    def finalize_options(self):
        setuptools.command.build_py.build_py.finalize_options(self)
    def run(self):
        result = setuptools.command.build_py.build_py.run(self)
        for target, files in node_dependencies:
            target = os.path.join(self.build_lib, target)
            if not os.path.exists(target):
                os.makedirs(target)
            for file in files:
                self.copy_file(file, target)
        return result
    def build_module(self, module, module_file, package):
        setuptools.command.build_py.build_py.build_module(self, module, module_file, package)
        if build_py.version and module == '__version__':
            package = package.split('.')
            outfile = self.get_module_outfile(self.build_lib, package, module)
            with open(outfile, 'w+') as f:
                f.write("__version__ = '" + package_version() + "'\n")

def package_version():
    folder = os.path.realpath(os.path.dirname(__file__))
    with open(os.path.join(folder, 'package.json')) as package_file:
        package_manifest = json.load(package_file)
        return package_manifest['version']

supported_frameworks = [
    '**ONNX** (`.onnx`, `.pb`)',
    '**Keras** (`.h5`, `.keras`)',
    '**CoreML** (`.mlmodel`)',
    '**TensorFlow Lite** (`.tflite`)'
]
experimental_frameworks = [
    '**Caffe** (`.caffemodel`)',
    '**Caffe2** (`predict_net.pb`)',
    '**MXNet** (`-symbol.json`)',
    '**TensorFlow.js** (`model.json`, `.pb`)',
    '**TensorFlow** (`.pb`, `.meta`)'
]
setuptools.setup(
    name="netron",
    version=package_version(),
    description="Viewer for neural network, deep learning and machine learning models",
    long_description='Netron is a viewer for neural network, deep learning and machine learning models.\n\n' +
                     'Netron supports {}. Netron has experimental support for {}'.format(','.join(supported_frameworks), ','.join(experimental_frameworks)),
    keywords=[
        'onnx', 'keras', 'tensorflow', 'coreml', 'mxnet', 'caffe', 'caffe2',
        'artificial intelligence', 'machine learning', 'deep learning', 'neural network',
        'visualizer', 'viewer'
    ],
    license="MIT",
    cmdclass={
        'build': build,
        'build_py': build_py
    },
    package_dir={
        'netron': 'src'
    },
    packages=[
        'netron'
    ],
    package_data={
        'netron': [ 
            'favicon.ico', 'icon.png',
            'numpy.js', 'base.js', 'zip.js', 'tar.js', 'gzip.js',
            'onnx.js', 'onnx-metadata.json', 'onnx-proto.js',
            'coreml.js', 'coreml-metadata.json', 'coreml-proto.js',
            'caffe.js', 'caffe-metadata.json', 'caffe-proto.js',
            'caffe2.js', 'caffe2-metadata.json', 'caffe2-proto.js',
            'keras.js', 'keras-metadata.json', 'hdf5.js',
            'mxnet.js', 'mxnet-metadata.json',
            'cntk.js', 'cntk-metadata.json', 'cntk-proto.js',
            'pytorch.js', 'pytorch-metadata.json', 'pickle.js',
            'sklearn.js', 'sklearn-metadata.json',
            'tf.js', 'tf-metadata.json', 'tf-proto.js', 
            'tflite.js', 'tflite-metadata.json', 'tflite-schema.js', 

            # OpenVINO IR
            'openvino-ir/openvino-ir.js',
            'openvino-ir/openvino-ir-graph.js',
            'openvino-ir/openvino-ir-node.js',
            'openvino-ir/openvino-ir-metadata.js',
            'openvino-ir/openvino-ir-metadata.json',
            'openvino-ir/openvino-ir-parser.js',
            
            # OpenVINO Xdot
            'openvino-xdot/openvino-xdot.js',
            'openvino-xdot/openvino-xdot-graph.js',
            'openvino-xdot/openvino-xdot-node.js',
            'openvino-xdot/openvino-xdot-metadata.js',
            'openvino-xdot/openvino-xdot-parser.js',

            'view-browser.html', 'view-browser.js',
            'view-grapher.css', 'view-grapher.js',
            'view-sidebar.css', 'view-sidebar.js',
            'view.js', 'view.css',
            'server.py'
        ]
    },
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
    ]
)