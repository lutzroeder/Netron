class OpenVINOIRXdotGraph {
    constructor(netDef, init) {
        this._name = netDef.id || '';
        this._version = Boolean(netDef.strict).toString();

        this._nodes = [];
        this._operators = {};
        this._inputs = [];
        this._outputs = [];

        const layers = _.filter(netDef.children, (child) => child.type === "node_stmt");
        const edges = _.filter(netDef.children, (child) => child.type === "edge_stmt");

        _.each(layers, (layer) => {
            const node = new OpenVINOIRXdotNode(layer, this._version, edges, layers);
            this._operators[node.operator] = _.get(this._operators, node.operator, 0) + 1;
            this._nodes.push(node);
        });

        _.each(edges, (edge) => {
            const from = edge.edge_list[0];
            const to = edge.edge_list[1];
            const child = _.find(this._nodes, (node) => node._id === to.id);
            if (child) {
                child.updateInputs(from.id);
            }
            const parent = _.find(this._nodes, (node) => node._id === from.id);
            if (parent) {
                parent.updateOutputs(to.id);
            }
        });
    }

    get name() {
        return this._name;
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

    get operators() {
        return this._operators;
    }
}
