/* jshint esversion: 6 */

const { desktopCapturer } = require('electron');

var paddle = paddle || {};
var base = base || require('./base');
var long = long || { Long: require('long') };
var protobuf = protobuf || require('./protobuf');

paddle.ModelFactory = class {

    match(context) {
        const identifier = context.identifier;
        const extension = identifier.split('.').pop().toLowerCase();
        if (identifier == '__model__' || extension == 'paddle' || extension == 'pdmodel') {
            return true;
        }
        return false;
    }

    open(context, host) {
        return host.require('./paddle-proto').then(() => {
            let desc = null;
            const identifier = context.identifier;
            try {
                paddle.proto = protobuf.get('paddle').paddle.framework.proto;
                const reader = protobuf.Reader.create(context.buffer);
                desc = paddle.proto.ProgramDesc.decode(reader);
            }
            catch (error) {
                throw new paddle.Error("File format is not paddle.ProgramDesc (" + error.message + ") in '" + identifier + "'.");
            }
            return paddle.Metadata.open(host).then((metadata) => {
                try {
                    const vars = new Set();
                    for (const block of desc.blocks) {
                        const blockVars = new Set();
                        for (const variable of block.vars) {
                            if (variable.persistable && variable.type &&
                                variable.type.type != paddle.proto.VarType.Type.FETCH_LIST &&
                                variable.type.type != paddle.proto.VarType.Type.FEED_MINIBATCH) {
                                blockVars.add(variable.name);
                            }
                        }
                        for (const op of block.ops) {
                            for (const input of op.inputs) {
                                for (const argument of input.arguments) {
                                    if (blockVars.has(argument)) {
                                        vars.add(argument);
                                    }
                                }
                            }
                        }
                    }
                    const promises = Array.from(vars).map((name) => context.request(name, null));
                    return Promise.all(promises).then((buffers) => {
                        const map = new Map();
                        const keys = Array.from(vars);
                        for (let i = 0; i < keys.length; i++) {
                            map.set(keys[i], buffers[i]);
                        }
                        return new paddle.Model(metadata, desc, map);
                    }).catch((err) => {
                        return new paddle.Model(metadata, desc, new Map());
                    });
                }
                catch (error) {
                    host.exception(error, false);
                    throw new paddle.Error(error.message);
                }
            });
        });
    }
};

paddle.Model = class {

    constructor(metadata, desc, buffers) {
        this._graphs = desc.blocks.map((block) => new paddle.Graph(metadata, block, buffers));
    }

    get graphs() {
        return this._graphs;
    }

    get format() {
        return 'PaddlePaddle';
    }
};

paddle.Graph = class {

    constructor(metadata, block, buffers) {
        this._nodes = [];
        this._inputs = [];
        this._outputs = [];

        const args = new Map();
        for (const variable of block.vars) {
            const type = variable.type && variable.type.type && variable.type.lod_tensor && variable.type.lod_tensor.tensor ? new paddle.TensorType(variable.type.lod_tensor.tensor) : null;
            const tensor = variable.persistable && variable.type && variable.type.type != paddle.proto.VarType.Type.FETCH_LIST && variable.type.type != paddle.proto.VarType.Type.FEED_MINIBATCH ? new paddle.Tensor(type, buffers.get(variable.name)) : null;
            args.set(variable.name, new paddle.Argument(variable.name, type, tensor));
        }

        const scope = {};
        for (let i = 0; i < block.ops.length; i++) {
            for (const input of block.ops[i].inputs) {
                input.arguments = input.arguments.map((argument) => scope[argument] ? scope[argument] : argument);
            }
            for (const output of block.ops[i].outputs) {
                output.arguments = output.arguments.map((argument) => {
                    if (scope[argument]) {
                        const next = argument + '\n' + i.toString(); // custom argument id
                        scope[argument] = next;
                        return next;
                    }
                    scope[argument] = argument;
                    return argument;
                });
            }
        }

        for (const op of block.ops) {
            for (const input of op.inputs) {
                for (const argument of input.arguments) {
                    const name = argument; // .split('\n').shift();
                    if (!args.has(name)) {
                        args.set(name, new paddle.Argument(name, null, null));
                    }
                }
            }
            for (const output of op.outputs) {
                for (const argument of output.arguments) {
                    const name = argument; // .split('\n').shift();
                    if (!args.has(name)) {
                        args.set(name, new paddle.Argument(name, null, null));
                    }
                }
            }
        }

        let lastNode = null;
        let lastOutput = null;
        for (const op of block.ops) {
            if (op.type == 'feed') {
                const inputName = op.attrs.filter((attr) => attr.name == 'col')[0].i.toString();
                this._inputs.push(new paddle.Parameter(inputName, op.outputs[0].arguments.map((id) => args.get(id))));
            }
            else if (op.type == 'fetch') {
                const outputName = op.attrs.filter((attr) => attr.name == 'col')[0].i.toString();
                this._outputs.push(new paddle.Parameter(outputName, op.inputs[0].arguments.map((id) => args.get(id))));
            }
            else {
                const node = new paddle.Node(metadata, op, args);
                if (op.inputs.length == 1 && op.inputs[0].arguments.length == 1 &&
                    op.outputs.length >= 1 && op.outputs[0].arguments.length == 1 &&
                    op.inputs[0].arguments[0].split('\n').shift() == op.outputs[0].arguments[0].split('\n').shift() &&
                    lastNode &&
                    lastOutput == op.inputs[0].arguments[0].split('\n').shift()) {
                    lastNode.chain.push(node);
                }
                else {
                    this._nodes.push(node);
                    lastNode = null;
                    lastOutput = null;
                    if (op.outputs.length == 1 && op.outputs[0].arguments.length == 1) {
                        lastNode = node;
                        lastOutput = op.outputs[0].arguments[0].split('\n').shift();
                    }
                }
            }
        }
    }

    get inputs() {
        return this._inputs;
    }

    get outputs() {
        return this._outputs;
    }

    get nodes() {
        return this._nodes;
    }
};


paddle.Parameter = class {
    constructor(name, args) {
        this._name = name;
        this._arguments = args;
    }

    get name() {
        return this._name;
    }

    get visible() {
        return true;
    }

    get arguments() {
        return this._arguments;
    }
};

paddle.Argument = class {

    constructor(name, type, initializer) {
        if (typeof name !== 'string') {
            throw new paddle.Error("Invalid argument identifier '" + JSON.stringify(name) + "'.");
        }
        this._name = name;
        this._type = type || null;
        this._initializer = initializer || null;
    }

    get name() {
        return this._name;
    }

    get type() {
        if (this._type) {
            return this._type;
        }
        if (this._initializer) {
            return this._initializer.type;
        }
        return null;
    }

    get initializer() {
        return this._initializer;
    }
};

paddle.Node = class {

    constructor(metadata, op, args) {
        this._metadata = metadata;
        this._type = op.type;
        this._attributes = [];
        this._inputs = [];
        this._outputs = [];
        this._chain = [];
        for (const attr of op.attrs) {
            const schema = metadata.attribute(this._type, this._name);
            this._attributes.push(new paddle.Attribute(schema, attr));
        }
        for (const input of op.inputs) {
            if (input.arguments.length > 0) {
                this._inputs.push(new paddle.Parameter(input.parameter, input.arguments.map((name) => args.get(name))));
            }
        }
        for (const output of op.outputs) {
            if (output.arguments.length > 0) {
                this._outputs.push(new paddle.Parameter(output.parameter, output.arguments.map((name) => args.get(name))));
            }
        }
        this._update(this._inputs, 'X');
        this._update(this._inputs, 'Input');
        this._update(this._outputs, 'Y');
        this._update(this._outputs, 'Out');
    }

    get type() {
        return this._type;
    }

    get name() {
        return '';
    }

    get metadata() {
        return this._metadata.type(this._type);
    }

    get attributes() {
        return this._attributes;
    }

    get inputs() {
        return this._inputs;
    }

    get outputs() {
        return this._outputs;
    }

    get chain() {
        return this._chain;
    }

    _update(list, name) {
        let item = null;
        for (let i = 0; i < list.length; i++) {
            if (list[i].name == name) {
                item = list[i];
                list.splice(i, 1);
                break;
            }
        }
        if (item) {
            list.splice(0, 0, item);
        }
    }
};

paddle.Attribute = class {

    constructor(schema, attr) {
        this._name = attr.name;
        this._value = '?';
        switch (attr.type) {
            case paddle.proto.AttrType.STRING:
                this._type = 'string';
                this._value = attr.s;
                break;
            case paddle.proto.AttrType.STRINGS:
                this._type = 'string[]';
                this._value = attr.strings;
                break;
            case paddle.proto.AttrType.BOOLEAN:
                this._type = 'boolean';
                this._value = attr.b;
                break;
            case paddle.proto.AttrType.BOOLEANS:
                this._type = 'boolean[]';
                this._value = attr.bools;
                break;
            case paddle.proto.AttrType.FLOAT:
                this._type = 'float32';
                this._value = attr.f;
                break;
            case paddle.proto.AttrType.FLOATS:
                this._type = 'float[]';
                this._value = attr.floats;
                break;
            case paddle.proto.AttrType.INT:
                this._type = 'int32';
                this._value = attr.i;
                break;
            case paddle.proto.AttrType.INTS:
                this._type = 'int32[]';
                this._value = attr.ints;
                break;
            case paddle.proto.AttrType.LONG:
                this._type = 'int64';
                break;
            case paddle.proto.AttrType.LONGS:
                this._type = 'int64[]';
                break;
            default:
                break;
        }
        switch (this._name) {
            case 'use_mkldnn':
            case 'use_cudnn':
            case 'op_callstack':
            case 'op_role':
            case 'op_role_var':
            case 'op_namescope':
            case 'is_test':
                this._visible = false;
                break;
        }
        if (schema) {
            if (Object.prototype.hasOwnProperty.call(schema, 'default')) {
                const defaultValue = schema.default;
                const value = this._value;
                if (defaultValue == value) {
                    this._visible = false;
                }
                else if (Array.isArray(value) && Array.isArray(defaultValue) && value.length == defaultValue.length) {
                    if (value.every((item, index) => { return item == defaultValue[index]; })) {
                        this._visible = false;
                    }
                }

            }
        }
    }

    get name() {
        return this._name;
    }

    get type() {
        return this._type;
    }

    get value() {
        return this._value;
    }

    get visible() {
        return this._visible == false ? false : true;
    }
};

paddle.Tensor = class {

    constructor(type, buffer) {
        this._type = type;
        if (buffer && buffer.length > 20 && buffer.slice(0, 16).every((value) => value === 0x00)) {
            const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
            const length = view.getUint32(16, true);
            // const header = buffer.slice(20, 20 + length);
            // const reader = protobuf.Reader.create(header);
            // const tensorDesc = paddle.proto.VarType.TensorDesc.decode(reader);
            this._data = buffer.slice(20 + length);
        }
    }

    get type() {
        return this._type;
    }

    get state() {
        return this._context().state || null;
    }

    get value() {
        const context = this._context();
        if (context.state) {
            return null;
        }
        context.limit = Number.MAX_SAFE_INTEGER;
        return this._decode(context, 0);
    }

    toString() {
        const context = this._context();
        if (context.state) {
            return '';
        }
        context.limit = 10000;
        const value = this._decode(context, 0);
        return paddle.Tensor._stringify(value, '', '    ');
    }

    _context() {
        const context = {};
        context.index = 0;
        context.count = 0;
        context.state = null;

        if (!this._data) {
            context.state = 'Tensor data is empty.';
            return context;
        }
        if (!this._type) {
            context.state = 'Tensor has no data type.';
            return context;
        }

        context.dataType = this._type.dataType;
        context.shape = this._type.shape.dimensions;
        context.view = new DataView(this._data.buffer, this._data.byteOffset, this._data.byteLength);

        switch (context.dataType) {
            case 'float32':
            case 'int32':
            case 'int64':
                break;
            default:
                context.state = "Tensor data type '" + context.dataType + "' is not implemented.";
                break;
        }
        return context;
    }

    _decode(context, dimension) {
        const shape = context.shape.length !== 0 ? context.shape : [ 1 ];
        const results = [];
        const size = shape[dimension];
        if (dimension == shape.length - 1) {
            for (let i = 0; i < size; i++) {
                if (context.count > context.limit) {
                    results.push('...');
                    return results;
                }
                switch (context.dataType) {
                    case 'float32':
                        results.push(context.view.getFloat32(context.index, true));
                        context.index += 4;
                        context.count++;
                        break;
                    case 'int32':
                        results.push(context.view.getInt32(context.index, true));
                        context.index += 4;
                        context.count++;
                        break;
                    case 'int64':
                        results.push(new long.Long(context.data.getUint32(context.index, true), context.data.getUint32(context.index + 4, true), false));
                        context.index += 8;
                        context.count++;
                        break;

                }
            }
        }
        else {
            for (let j = 0; j < size; j++) {
                if (context.count > context.limit) {
                    results.push('...');
                    return results;
                }
                results.push(this._decode(context, dimension + 1));
            }
        }
        if (context.shape.length == 0) {
            return results[0];
        }
        return results;
    }

    static _stringify(value, indentation, indent) {
        if (Array.isArray(value)) {
            const result = [];
            result.push(indentation + '[');
            const items = value.map((item) => paddle.Tensor._stringify(item, indentation + indent, indent));
            if (items.length > 0) {
                result.push(items.join(',\n'));
            }
            result.push(indentation + ']');
            return result.join('\n');
        }
        if (typeof value == 'string') {
            return indentation + value;
        }
        if (value == Infinity) {
            return indentation + 'Infinity';
        }
        if (value == -Infinity) {
            return indentation + '-Infinity';
        }
        if (isNaN(value)) {
            return indentation + 'NaN';
        }
        return indentation + value.toString();
    }
};

paddle.TensorType = class {

    constructor(desc) {
        switch (desc.data_type) {
            case paddle.proto.VarType.Type.INT32:
                this._dataType = 'int32';
                break;
            case paddle.proto.VarType.Type.INT64:
                this._dataType = 'int64';
                break;
            case paddle.proto.VarType.Type.FP32:
                this._dataType = 'float32';
                break;
            case paddle.proto.VarType.Type.FP64:
                this._dataType = 'float64';
                break;
            default:
                this._dataType = '?';
                break;
        }
        this._shape = new paddle.TensorShape(desc.dims);
    }

    get dataType() {
        return this._dataType;
    }

    get shape() {
        return this._shape;
    }

    get denotation() {
        return this._denotation;
    }

    toString() {
        return this.dataType + this._shape.toString();
    }
};

paddle.TensorShape = class {

    constructor(dimensions) {
        dimensions = dimensions.map((dimension) => dimension.toNumber());
        this._dimensions = dimensions.map((dimension) => {
            return dimension != -1 ? dimension : '?';
        });
    }

    get dimensions() {
        return this._dimensions;
    }

    toString() {
        return (this._dimensions && this._dimensions.length) ? ('[' + this._dimensions.join(',') + ']') : '';
    }
};

paddle.Metadata = class {

    static open(host) {
        if (paddle.Metadata._metadata) {
            return Promise.resolve(paddle.Metadata._metadata);
        }
        return host.request(null, 'paddle-metadata.json', 'utf-8').then((data) => {
            paddle.Metadata._metadata = new paddle.Metadata(data);
            return paddle.Metadata._metadata;
        }).catch(() => {
            paddle.Metadata._metadata = new paddle.Metadata(null);
            return paddle.Metadata._metadata;
        });
    }

    constructor(data) {
        this._map = {};
        this._attributeCache = {};
        if (data) {
            const items = JSON.parse(data);
            if (items) {
                for (const item of items) {
                    item.schema.name = item.name;
                    this._map[item.name] = item.schema;
                }
            }
        }
    }

    type(name) {
        return this._map[name] || null;
    }

    attribute(type, name) {
        let map = this._attributeCache[type];
        if (!map) {
            map = {};
            const schema = this.type(type);
            if (schema && schema.attributes && schema.attributes.length > 0) {
                for (const attribute of schema.attributes) {
                    map[attribute.name] = attribute;
                }
            }
            this._attributeCache[type] = map;
        }
        return map[name] || null;
    }
};

paddle.Error = class extends Error {
    constructor(message) {
        super(message);
        this.name = 'Error loading PaddlePaddle model.';
    }
};

if (typeof module !== 'undefined' && typeof module.exports === 'object') {
    module.exports.ModelFactory = paddle.ModelFactory;
}
