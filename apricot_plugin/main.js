define([
    'require',
    'jquery',
    'base/js/namespace',
    'base/js/events',
    'node_modules/js-yaml/dist/js-yaml.js'
], function (
    requirejs,
    $,
    Jupyter,
    events,
    jsyaml
) {

    "use strict";

    //********************//
    //* Global variables *//
    //********************//

    var Kernel = Jupyter.notebook.kernel;
    var prefix = "infrastructure-deployment";
    var childs = [];
    var deployInfo = {};
    var deploying = false; //Stores if the notebook is deploying something

    var clearDeployInfo = function () {
        var childs = [];
        if (typeof deployInfo.childs != undefined) {
            childs = deployInfo.childs;
        }

        var recipe = ""
        if (typeof deployInfo.recipe != undefined) {
            recipe = deployInfo.recipe;
        }

        deployInfo = {
            "recipe": recipe,
            "id": "",
            "deploymentType": "",
            "host": "ramses.i3m.upv.es:2633",
            "tenant": "",
            "user": "asanchez",
            "credential": "RamsesOpenNebula9",
            "port": "",
            "infName": "infra-name",
            "worker": {
                "num_instances": 1,
                "num_cpus": 1,
                "mem_size": "2 GB",
                "disk_size": "20 GB",
                "num_gpus": 1,
                "image": "",
            },
            "childs": childs,
        }
    };

    var loadCSS = function () {
        console.log("Loading css");
        var link = document.createElement("link");
        link.type = "text/css";
        link.rel = "stylesheet";
        link.href = requirejs.toUrl("./main.css");
        document.getElementsByTagName("head")[0].appendChild(link);
    };

    var createTable = function (data) {
        var table = $("<table>").addClass("deployments-table");
        var headerRow = $("<tr>");

        // Create table headers based on the keys of the data object
        for (var key in data) {
            headerRow.append($("<th>").text(key));
        }
        table.append(headerRow);

        // Iterate over the clusters data and create table rows
        for (var i = 0; i < data["Name"].length; i++) {
            var row = $("<tr>");
            for (var key in data) {
                var cell = $("<td>").text(data[key][i]);
                row.append(cell);
            }
            table.append(row);
        }

        return table;
    };

    //****************//
    //*   Buttons    *//
    //****************//

    var listDeploymentsButton = function () {
        console.log("Creating deployments list button");
        if (!Jupyter.toolbar) {
            events.on("app_initialized.NotebookApp", listDeploymentsButton);
            return;
        }
        if ($("#listDeploymentsButton").length === 0) {
            Jupyter.toolbar.add_buttons_group([
                Jupyter.actions.register({
                    "help": "Deployed infrastructures",
                    "icon": "fa-th-list",
                    "handler": toggleListDeploymentsDialog,
                }, "toggle-deployment-list", prefix)
            ]);
        }
    };

    var deployMenuButton = function () {
        console.log("Creating deploy menu button");
        if (!Jupyter.toolbar) {
            events.on("app_initialized.NotebookApp", deployMenuButton);
            return;
        }
        clearDeployInfo();

        if ($("#deployMenuButton").length === 0) {
            Jupyter.toolbar.add_buttons_group([
                Jupyter.actions.register({
                    "help": "Infrastructure deployment",
                    "icon": "fal fa-sitemap",
                    "handler": toggleDeployDialog,
                }, "toggle-deploy", prefix)
            ]);
        }
    };

    //********************//
    //* Dialogs handlers *//
    //********************//    

    var toggleDeployDialog = function () {
        if ($("#dialog-deploy").dialog("isOpen")) {
            $("#dialog-deploy").dialog("close");
        } else {
            $("#dialog-deploy").dialog("open");
            $("#dialog-deploy").dialog("moveToTop");
        }
        Jupyter.notebook.set_dirty();
    };

    var toggleListDeploymentsDialog = function () {
        if ($("#dialog-deployments-list").dialog("isOpen")) {
            $("#dialog-deployments-list").dialog("close");
        } else {
            createListDeploymentsDialog(true);
            $("#dialog-deployments-list").dialog("moveToTop");
        }
        Jupyter.notebook.set_dirty();
    };

    var createOrUpdateDialog = function (table, show) {
        // Check if dialog has been already created
        if ($("#dialog-deployments-list").length == 0) {
            var listDeployment_dialog = $('<div id="dialog-deployments-list" title="Deployments list">')
                .append(table);
            $("body").append(listDeployment_dialog);
            $("#dialog-deployments-list").dialog();
        } else {
            // Clear dialog
            $("#dialog-deployments-list").empty();
            $("#dialog-deployments-list").append(table);
            $("#dialog-deployments-list").dialog("open");
        }
        if (show == false) {
            $("#dialog-deployments-list").dialog("close");
        }
    };

    //****************//
    //*   Dialogs    *//
    //****************//

    var createListDeploymentsDialog = function (show) {
        //If kernel is not available, call the function again when it is available
        if (typeof Jupyter.notebook.kernel == "undefined" || Jupyter.notebook.kernel == null) {
            events.on("kernel_ready.Kernel", function (evt, data) {
                createListDeploymentsDialog(show);
            });
            return;
        }

        var cmdCatList = "cat apricot_plugin/infrastructuresList.json";

        // Get cluster list 
        var callbackStateAndIP = {
            iopub: {
                output: function (data) {
                    // // Check message
                    // var check = checkStream(data);
                    // console.log("check", check);
                    // console.log("data", data);
                    // if (check < 0) return; // Not a stream
                    // if (check > 0) { // Error message
                    //     alert("alert", data.content.text);
                    //     return;
                    // }

                    // Parse data
                    var words = data.content.text.split(" ");
                    console.log("words", words);

                    var tableList = {};
                    tableList["Name"] = [];
                    tableList["ID"] = [];
                    tableList["IP"] = [];
                    tableList["State"] = [];

                    // Load infrastructure list using AJAX
                    $.get('apricot_plugin/infrastructuresList.json', function (infraList) {
                        if (infraList.infrastructures.length === 0) {
                            // If infrastructure list is empty, create an empty table
                            var table = createTable(tableList);
                            createOrUpdateDialog(table, show);
                            return;
                        }

                        // Counter to keep track of completed state and IP retrievals
                        var completedStates = 0;
                        var completedIPs = 0;

                        // Iterate through each infrastructure to get its state
                        for (let i = 0; i < infraList.infrastructures.length; i++) {
                            var infrastructure = infraList.infrastructures[i];
                            tableList.Name.push(infrastructure.name);
                            tableList.ID.push(infrastructure.infrastructureID);

                            var cmdState = infrastructureState(infrastructure);
                            console.log("cmdState", cmdState);
                            var callbackState = {
                                // Callback function to handle state output
                                iopub: {
                                    output: function (stateData) {
                                        // var stateCheck = checkStream(stateData);
                                        // console.log("stateCheck", stateCheck);
                                        // if (stateCheck < 0) return; // Not a stream
                                        // if (stateCheck > 0) { // Error message or contains "error"
                                        //     // If it does, display the entire output as an error message
                                        //     tableList.State.push(stateData.content.text);
                                        //     // return;
                                        // }
                                        // Successfully execution
                                        var stateWords = stateData.content.text.split(" ");
                                        console.log("stateWords", stateWords);
                                        var stateIndex = stateWords.indexOf("state:");
                                        console.log("stateIndex", stateIndex);
                                        if (stateIndex !== -1 && stateIndex < stateWords.length - 1) {
                                            var state = stateWords[stateIndex + 1].trim();
                                            tableList.State.push(state);

                                            // Increment completed states count
                                            completedStates++;

                                            // If all states are retrieved, create the table
                                            if (completedStates === infraList.infrastructures.length && completedIPs === infraList.infrastructures.length) {
                                                var table = createTable(tableList);
                                                createOrUpdateDialog(table, show);
                                            }
                                        }
                                    }
                                }
                            };

                            // Execute infrastructureState command
                            Kernel.execute(cmdState, callbackState);
                        }

                        // Iterate through each infrastructure to get its IP
                        for (let i = 0; i < infraList.infrastructures.length; i++) {
                            var infrastructureID = infraList.infrastructures[i].infrastructureID;
                            var cmdIP = infrastructureIP(infrastructureID);
                            console.log("cmdIP", cmdIP);
                            var callbackIP = {
                                // Callback function to handle IP output
                                iopub: {
                                    output: function (ipData) {
                                        // var ipCheck = checkStream(ipData);
                                        // if (ipCheck < 0) return; // Not a stream
                                        // if (ipCheck > 0) { // Error message
                                        //     tableList.IP.push(ipData.content.text);
                                        //     return;
                                        // }

                                        // Successfully execution
                                        var ip = ipData.content.text.trim();

                                        if (!ip.toLowerCase().includes("error")) {
                                            // Extract the IP from the output (get the last word)
                                            ip = ip.split(" ").pop();
                                        }

                                        tableList.IP.push(ip);

                                        // Increment completed IPs count
                                        completedIPs++;

                                        // If all IPs are retrieved, create the table
                                        if (completedStates === infraList.infrastructures.length && completedIPs === infraList.infrastructures.length) {
                                            var table = createTable(tableList);
                                            createOrUpdateDialog(table, show);
                                        }
                                    }
                                }
                            };

                            // Execute infrastructureIP command
                            Kernel.execute(cmdIP, callbackIP);
                        }
                    });
                }
            }
        };

        // Execute command to retrieve infrastructure list
        Kernel.execute(cmdCatList, callbackStateAndIP);
    };

    var createDeployDialog = function () {
        console.log("Creating deploy window");

        var deployDialog = $('<div id="dialog-deploy" title="Deploy infrastructure">')

        $("body").append(deployDialog);
        $("#dialog-deploy").dialog()
        deployChooseProvider();
        $("#dialog-deploy").dialog("close");
    };

    //****************//
    //*  Deployment  *//
    //****************// 

    // Select provider
    var deployChooseProvider = function () {
        //Get dialog
        var deployDialog = $("#dialog-deploy");

        //Clear instance type
        deployInfo.worker.instance = "";

        //Clear dialog
        deployDialog.empty();

        deployDialog.append($("<p>Select infrastructure provider:</p>"));

        deployDialog.dialog("option", "buttons",
            [
                {
                    text: "OpenNebula",
                    click: function () {
                        //Check if the provider has been changed
                        if (deployInfo.deploymentType != "OpenNebula") {
                            clearDeployInfo();
                        }

                        deployInfo.id = "one";
                        deployInfo.deploymentType = "OpenNebula";
                        deployRecipeType();
                    }
                },
                {
                    text: "EC2",
                    click: function () {
                        //Check if the provider has been changed
                        if (deployInfo.deploymentType != "EC2") {
                            clearDeployInfo();
                        }

                        deployInfo.id = "ec2";
                        deployInfo.deploymentType = "EC2";
                        deployRecipeType();
                    },
                },
                {
                    text: "OpenStack",
                    click: function () {
                        //Check if the provider has been changed
                        if (deployInfo.deploymentType != "OpenStack") {
                            clearDeployInfo();
                        }

                        deployInfo.id = "ost";
                        deployInfo.deploymentType = "OpenStack";
                        deployRecipeType();
                    }
                }
            ]);
    };

    // Select recipe type
    var deployRecipeType = function () {
        //Get dialog
        var deployDialog = $("#dialog-deploy");

        //Enable shortcuts
        Jupyter.keyboard_manager.enable();

        //Clear dialog
        deployDialog.empty();

        deployDialog.append($("<p>Select recipe type:</p>"));

        deployDialog.dialog("option", "buttons", {
            "Back": {
                text: "Back",
                icon: "ui-icon-circle-arrow-w",
                showText: false,
                click: deployChooseProvider
            },
            "Simple-node-disk": function () {
                deployInfo.recipe = "Simple-node-disk";
                childs = ["galaxy", "ansible_tasks", "noderedvm", "minio_compose"];
                deployRecipeChilds();
            },
            "Slurm": function () {
                deployInfo.recipe = "Slurm";
                childs = ["slurm_cluster", "slurm_elastic", "slurm_galaxy", "docker_cluster"];
                deployRecipeChilds();
            },
            "Kubernetes": function () {
                deployInfo.recipe = "Kubernetes";
                childs = ["kubernetes", "kubeapps", "prometheus", "minio_compose", "noderedvm", "influxdb", "argo"];
                deployRecipeChilds();
            }
        });

    };

    // Select childs for main recipe
    var deployRecipeChilds = function () {
        // Get dialog
        var deployDialog = $("#dialog-deploy");

        // Enable shortcuts
        Jupyter.keyboard_manager.enable();

        // Clear dialog
        deployDialog.empty();

        deployDialog.append($("<p>Select optional recipe features:</p><br>"));
        // Create check boxes with optional childs
        var ul = $('<ul class="checkbox-grid">');
        for (let i = 0; i < childs.length; i++) {
            // Load YAML file
            $.get('templates/' + childs[i].toLowerCase() + '.yaml', function (data) {
                // Parse YAML content
                var yamlContent = jsyaml.load(data);
                var metadata = yamlContent.metadata;
                var templateName = metadata.template_name;

                // Create line
                let line = $('<li></li>');
                // Create checkbox
                let checkbox = $('<input type="checkbox" id="' + childs[i] + '-checkID" name="' + childs[i] + '" value="' + templateName + '">');
                // Create label
                let label = $('<label for="' + childs[i] + '"></label>');
                label.text(" " + templateName);

                // Check if recipe is Slurm or Kubernetes
                if (deployInfo.recipe === "Slurm" && childs[i] === "slurm_cluster" ||
                    deployInfo.recipe === "Kubernetes" && childs[i] === "kubernetes") {
                    checkbox.prop('checked', true); // Check the checkbox
                    checkbox.prop('disabled', true); // Disable the checkbox
                }

                // Append checkbox and label to line
                line.append(checkbox);
                line.append(label);

                // Append line to grid
                ul.append(line);
                // Append line break after each line
                ul.append('<br>');
            });
        }

        // Append all to dialog
        deployDialog.append(ul);

        deployDialog.dialog("option", "buttons", {
            "Back": deployRecipeType,
            "Next": function () {
                // Set childs
                var selectedChilds = [];
                for (var i = 0; i < childs.length; i++) {
                    var childID = childs[i] + "-checkID";
                    if ($("#" + childID).is(":checked")) {
                        selectedChilds.push(childs[i]);
                    }
                }
                deployInfo.childs = selectedChilds;

                deployProviderCredentials();
            }
        });
    };

    // Introduce credentials
    var deployProviderCredentials = function () {
        //Get dialog
        var deployDialog = $("#dialog-deploy");

        //Clear dialog
        deployDialog.empty();

        //Disable shortcuts
        Jupyter.keyboard_manager.disable();

        //Create form for input
        var form = $("<form>")

        //Informative text
        var text1 = "";
        var text2 = "";
        var text3 = "";
        if (deployInfo.deploymentType == "EC2") {
            text1 = "<p>Introduce AWS IAM credentials.</p><br>";
            text2 = "Access Key ID:<br>";
            text3 = "Secret Access Key:<br>";
        }
        else if (deployInfo.deploymentType == "OpenNebula") {
            text1 = "<p>Introduce ONE credentials.</p><br>";
            text2 = "Username:<br>";
            text3 = "Password:<br>";

            //Create host input field
            form.append("Host and port:<br>");
            form.append($('<input id="hostIn" type="text" value="' + deployInfo.host + '" name="host"><br>'));

        }
        else if (deployInfo.deploymentType == "OpenStack") {
            text1 = "<p>Introduce OST credentials.</p><br>";
            text2 = "Username:<br>";
            text3 = "Password:<br>";

            //Create host input field
            form.append("Host and port:<br>");
            form.append($('<input id="hostIn" type="text" value="' + deployInfo.host + '" name="host"><br>'));
            //Create tenant (project) input field
            form.append("Tenant:<br>");
            form.append($('<input id="tenantIn" type="text" value="' + deployInfo.tenant + '" name="tenant"><br>'));
        }

        deployDialog.append($(text1));

        //Create username input field
        form.append(text2);
        form.append($('<input id="userIn" type="text" value="' + deployInfo.user + '" name="user"><br>'));

        //Create password input field
        form.append(text3);
        form.append($('<input id="userPassIn" type="password" value="' + deployInfo.credential + '" name="userPass"><br>'));

        deployDialog.append(form);

        deployDialog.dialog("option", "buttons", {
            "Back": function () {
                deployRecipeChilds();
            },
            "Next": function () {
                deployInfo.host = $('#hostIn').val();
                deployInfo.tenant = $('#tenantIn').val();
                deployInfo.user = $("#userIn").val();
                deployInfo.credential = $("#userPassIn").val();

                if (deployInfo.deploymentType == "EC2") {
                    deployEC2Credentials();
                }
                else { deployInfraConfiguration(); }
            }
        });
    };

    // Introduce EC2 credentials
    var deployEC2Credentials = function () {
        //Get dialog
        var deployDialog = $("#dialog-deploy");

        //Clear dialog
        deployDialog.empty();

        //Disable shortcuts
        Jupyter.keyboard_manager.disable();

        deployDialog.append($("<p>Introduce required EC2 instance types:</p><br>"));

        //Create form for input
        var form = $("<form>")

        var zone = "us-east-1";
        var ami = "ami-0044130ca185d0880";

        //Create availability zone input field
        form.append("Availability zone:<br>");
        form.append($('<input id="availabilityZoneIn" type="text" value="' + zone + '"><br>'));

        //Create AMI input field 
        form.append("AMI:<br>");
        form.append($('<input id="amiIn" type="text" value="' + ami + '"><br>'));

        if (deployInfo.recipe == "Simple-node-disk") {
            // Port to be opened on AWS
            form.append("Port to be opened in AWS:<br>");
            form.append($('<input id="infrastructurePort" type="number" value="1" min="1"><br>'));
        }

        //Append elements to dialog
        deployDialog.append(form);

        deployDialog.dialog("option", "buttons", {
            "Back": deployProviderCredentials,
            "Next": function () {
                var AWSzone = $("#availabilityZoneIn").val();
                var AMI = $("#amiIn").val();
                var imageURL = "aws://" + AWSzone + "/" + AMI;

                deployInfo.worker.image = imageURL;
                deployInfo.port = $("#infrastructurePort").val();

                deployInfraConfiguration();
            }
        });
    };

    // Introduce infrastructure configuration
    var deployInfraConfiguration = function () {
        //Get dialog
        var deployDialog = $("#dialog-deploy");

        //Clear dialog
        deployDialog.empty();

        //Disable shortcuts
        Jupyter.keyboard_manager.disable();

        //Create form for worker node
        var form = $("<form>")
        form.append($("<p>Introduce worker VM specifications.</p><br>"));

        form.append("Infrastructure name:<br>");
        form.append($('<input id="infrastructureName" type="text" value="' + deployInfo.infName + '"><br>'));

        form.append("Number of VMs:<br>");
        form.append($('<input id="infrastructureWorkers" type="number" value="1" min="1"><br>'));

        form.append("Number of CPUs for each VM:<br>");
        form.append($('<input id="infrastructureCPUs" type="number" value="1" min="1"><br>'));

        form.append("Memory for each VM:<br>");
        form.append($('<input id="infrastructureMem" type="text" value="2 GB"><br>'));

        form.append("Size of the root disk of the VM(s):<br>");
        form.append($('<input id="infrastructureDiskSize" type="text" value="20 GB"><br>'));

        form.append("Number of GPUs for each VM:<br>");
        form.append($('<input id="infrastructureGPUs" type="number" value="1" min="1"><br>'));

        deployDialog.append(form);

        deployDialog.dialog("option", "buttons", {
            "Back": function () {
                deployProviderCredentials();
            },
            "Next": {
                text: deployInfo.childs.length === 0 ? "Deploy" : "Next",
                click: function () {
                    deployInfo.infName = $("#infrastructureName").val();
                    deployInfo.worker.num_instances = $("#infrastructureWorkers").val();
                    deployInfo.worker.num_cpus = $("#infrastructureCPUs").val();
                    deployInfo.worker.mem_size = $("#infrastructureMem").val();
                    deployInfo.worker.disk_size = $("#infrastructureDiskSize").val();
                    deployInfo.worker.num_gpus = $("#infrastructureGPUs").val();

                    if (deployInfo.childs.length === 0) {
                        deployFinalRecipe();
                    } else {
                        deployChildsConfiguration();
                    }
                }
            }
        });
    };

    // Introduce childs configuration
    var deployChildsConfiguration = function () {
        // Get dialog
        var deployDialog = $("#dialog-deploy");

        // Clear dialog
        deployDialog.empty();

        // Disable shortcuts
        Jupyter.keyboard_manager.disable();

        var childs = deployInfo.childs;

        // Container for buttons
        var buttonsContainer = $('<div id="buttons-container"></div>');
        deployDialog.append(buttonsContainer);

        Promise.all(childs.map((app, index) => createForm(app, index, deployDialog, buttonsContainer))).then((forms, nodeTemplates, outputs) => {
            var nodeTemplates = forms.map(form => form.nodeTemplates);
            var outputs = forms.map(form => form.outputs);
            deployDialog.dialog("option", "buttons", {
                "Back": function () {
                    deployInfraConfiguration();
                },
                "Deploy": function () {
                    var userInputs = forms.map(async function (formData) {
                        var form = formData.form;
                        var childName = form.attr('id').replace('form-', '');
                        var recipeContent = await $.get('templates/' + childName + '.yaml');
                        var recipeData = jsyaml.load(recipeContent);
                        var recipeInputs = recipeData.topology_template.inputs;

                        // Create an object to hold input structure and values
                        var inputsWithValues = {};
                        Object.keys(recipeInputs).forEach(function (inputName) {
                            var defaultValue = recipeInputs[inputName].default || ''; // Get default value if exists
                            var userInput = form.find('[name="' + inputName + '"]').val(); // Get user input value
                            inputsWithValues[inputName] = {
                                description: recipeInputs[inputName].description,
                                default: defaultValue,
                                value: userInput
                            };
                        });

                        // Return the outputs to create final recipe to deploy
                        return {
                            name: childName,
                            inputs: inputsWithValues,
                            nodeTemplates: nodeTemplates,
                            outputs: outputs
                        };
                    });
                    deployFinalRecipe(userInputs, nodeTemplates, outputs);
                }
            });
        });
    };

    // Deploy final recipe
    var deployFinalRecipe = function (populatedTemplates, nodeTemplates, outputs) {
        var deployDialog = $("#dialog-deploy");

        // Clear dialog
        deployDialog.empty();

        // Disable shortcuts
        Jupyter.keyboard_manager.disable();

        // Deploy only one infrastructure at once
        if (deploying) {
            alert("Previous deploy has not finished.");
            return;
        }
        deploying = true;

        // Load using AJAX and parse the content of simple-node-disk.yaml
        $.get('templates/simple-node-disk.yaml', async function (content) {
            try {
                var parsedConstantTemplate = jsyaml.load(content);

                // Add infra_name field and a hash to metadata field
                var hash = await computeHash(JSON.stringify(deployInfo));
                parsedConstantTemplate.metadata = parsedConstantTemplate.metadata || {};
                parsedConstantTemplate.metadata.infra_name = "jupyter_" + hash;

                // Populate parsedConstantTemplate with worker values
                var workerInputs = parsedConstantTemplate.topology_template.inputs;
                Object.keys(deployInfo.worker).forEach(function (key) {
                    if (workerInputs.hasOwnProperty(key)) {
                        // Update the default value of the existing input
                        workerInputs[key].default = deployInfo.worker[key];
                    } else {
                        // If the input doesn't exist, add it dynamically
                        workerInputs[key] = {
                            type: typeof deployInfo.worker[key],
                            default: deployInfo.worker[key]
                        };
                    }
                });

                // Merge parsed constant template with populated templates
                var mergedTemplate = mergeTOSCARecipes(parsedConstantTemplate, populatedTemplates, nodeTemplates, outputs);

                // Ensure mergedTemplate is resolved before dumping YAML
                Promise.resolve(mergedTemplate).then(function (resolvedTemplate) {
                    var yamlContent = jsyaml.dump(resolvedTemplate);

                    // Create deploy script
                    var cmdDeployIMCommand = deployIMCommand(deployInfo, yamlContent);

                    // Clear dialog
                    deployDialog.empty();

                    // Show loading spinner
                    deployDialog.append($('<div class="loader"></div>'));

                    // Remove buttons
                    deployDialog.dialog("option", "buttons", {});

                    // Create kernel callback
                    var callbackDeployInfra = {
                        iopub: {
                            output: function (data) {
                                // Check if the content contains an error
                                if (data.content.text.toLowerCase().includes("error")) {
                                    // Execute the error handling code if "error" is found
                                    deploying = false;
                                    alert(data.content.text);
                                    console.log(data.content.text);
                                    if (deployInfo.childs.length === 0) {
                                        deployInfraConfiguration();
                                    } else deployChildsConfiguration();
                                } else {
                                    var pubtext = data.content.text.replace("\r", "\n");
                                    deploying = false;
                                    alert(pubtext);
                                    console.log(pubtext);

                                    // Extract infrastructure ID
                                    var idMatch = pubtext.match(/ID: ([\w-]+)/);
                                    var infrastructureID = idMatch[1];

                                    // Create a JSON object
                                    var jsonObj = {
                                        name: deployInfo.infName,
                                        infrastructureID: infrastructureID,
                                        id: deployInfo.id,
                                        type: deployInfo.deploymentType,
                                        host: deployInfo.host,
                                        tenant: deployInfo.tenant,
                                        user: deployInfo.user,
                                        pass: deployInfo.credential,
                                        tenant: deployInfo.tenant,
                                        // domain: deployInfo.domain,
                                        // authVersion: deployInfo.authVersion,
                                        // api_version: deployInfo.apiVersion, // Not needed
                                    };

                                    var cmdSaveToInfrastructureList = saveToInfrastructureList(jsonObj);
                                    Kernel.execute(cmdSaveToInfrastructureList);

                                    createDeployDialog();
                                }
                            }
                        }
                    };

                    // Deploy using IM
                    Kernel.execute(cmdDeployIMCommand, callbackDeployInfra);

                });
            } catch (error) {
                console.error("Error parsing simple-node-disk.yaml:", error);
            }
        });
    };

    //**********************//
    //* Auxiliar functions *//
    //**********************//

    // Dynamically create child forms based on YAML templates
    async function createForm(app, index, deployDialog, buttonsContainer) {
        var form = $('<form id="form-' + app.toLowerCase() + '">');
        var response = await $.get('templates/' + app.toLowerCase() + '.yaml');
        var data = jsyaml.load(response);
        var metadata = data.metadata;
        var templateName = metadata.template_name;
        var inputs = data.topology_template.inputs;
        var nodeTemplates = data.topology_template.node_templates;
        var outputs = data.topology_template.outputs;
        // Create button with the template name
        var appButton = $('<button class="formButton">' + templateName + '</button>');

        form.append("<p>Specifications for the " + templateName + " application.</p>");

        // Hide all forms and only show the form for the selected app
        appButton.click(function () {
            deployDialog.find('form').hide();
            form.show();
        });

        // Append button to buttons container
        buttonsContainer.append(appButton);

        // Append form to dialog
        deployDialog.append(form);

        // Show the form for the first app by default
        if (index !== 0) {
            form.hide();
        }

        // Extract fields from YAML content
        if (inputs) {
            Object.keys(inputs).forEach(function (key) {
                var description = inputs[key].description;
                var constraints = inputs[key].constraints;

                if (constraints && constraints.length > 0 && constraints[0].valid_values) {
                    // If valid_values array exists, create dropdown menu
                    var validValues = constraints[0].valid_values;
                    var selectField = $('<select id="' + key + '" name="' + key + '">');
                    validValues.forEach(function (value) {
                        var option = $('<option value="' + value + '">' + value + '</option>');
                        selectField.append(option);
                    });
                    form.append('<br><label for="' + key + '">' + description + ':</label><br>');
                    form.append(selectField);
                } else {
                    // Otherwise, create text input field
                    var inputField = $('<input type="text" id="' + key + '" name="' + key + '">');
                    form.append('<br><label for="' + key + '">' + description + ':</label><br>');
                    form.append(inputField);
                }
            });
        } else {
            form.append("<p>No inputs to be filled.</p><br>");
        }

        return {
            form,
            nodeTemplates,
            outputs
        };
    };

    var deployIMCommand = function (obj, mergedTemplate) {
        var pipeAuth = obj.infName + "-auth-pipe";
        var imageRADL = obj.infName;
        var cmd = "%%bash \n";
        cmd += "PWD=`pwd` \n";
        // Remove pipes if exist
        cmd += "rm $PWD/" + pipeAuth + " &> /dev/null \n";
        // Create directory for templates
        cmd += "mkdir $PWD/templates &> /dev/null \n";
        // Create pipes
        cmd += "mkfifo $PWD/" + pipeAuth + "\n";
        // Save mergedTemplate as a YAML file
        cmd += "echo '" + mergedTemplate + "' > ~/.imclient/templates/" + imageRADL + ".yaml \n";
        // Command to create the IM-cli credentials
        if (obj.deploymentType == "OpenStack") {
            cmd += "echo -e \"id = im; type = InfrastructureManager; username = user; password = pass;\n" +
                "id = " + obj.id + "; type = " + obj.deploymentType + "; host = " + obj.host + "; username = " + obj.user + "; password = " + obj.credential + "; tenant = " + obj.tenant + ";\" > $PWD/" + pipeAuth + " & \n";
        } else if (obj.deploymentType == "OpenNebula") {
            cmd += "echo -e \"id = im; type = InfrastructureManager; username = user; password = pass \n" +
                "id = " + obj.id + "; type = " + obj.deploymentType + "; host = " + obj.host + "; username = " + obj.user + "; password = " + obj.credential + ";\" > $PWD/" + pipeAuth + " & \n";
        } else if (obj.deploymentType == "AWS") {
            cmd += "echo -e \"id = im; type = InfrastructureManager; username = user; password = pass \n" +
                "id = " + obj.id + "; type = " + obj.deploymentType + "; host = " + obj.host + "; username = " + obj.user + "; password = " + obj.credential + "; image = " + obj.worker.image + ";\" > $PWD/" + pipeAuth + " & \n";
        }
        // Create final command where the output is stored in "imOut"
        cmd += "imOut=\"`python3 /usr/local/bin/im_client.py -a $PWD/" + pipeAuth + " create " + "~/.imclient/templates/" + imageRADL + ".yaml -r https://im.egi.eu/im" + " `\" \n";
        // Remove pipe
        cmd += "rm $PWD/" + pipeAuth + " &> /dev/null \n";
        // Print IM output on stderr or stdout
        cmd += "if [ $? -ne 0 ]; then \n";
        cmd += "    >&2 echo -e $imOut \n";
        cmd += "    exit 1\n";
        cmd += "else\n";
        cmd += "    echo -e $imOut \n";
        cmd += "fi\n";

        console.log("cmd", cmd);
        return cmd;
    };

    var saveToInfrastructureList = function (obj) {
        // Only works if the { "infrastructures": [ ] } structure exists in the JSON file
        var filePath = "$PWD/apricot_plugin/infrastructuresList.json";
        var cmd = "%%bash \n";
        // Read infrastructureList.json
        cmd += "existingJson=$(cat " + filePath + ")\n";
        // Append new object
        cmd += "newJson=$(echo $existingJson | jq '.infrastructures += [" + JSON.stringify(obj) + "]')\n";
        // Write updated JSON back to file
        cmd += "echo $newJson > " + filePath + "\n";
        console.log("cmd", cmd);
        return cmd;
    };

    async function mergeTOSCARecipes(parsedConstantTemplate, userInputs, nodeTemplates, outputs) {
        try {
            var mergedTemplate = JSON.parse(JSON.stringify(parsedConstantTemplate));
            // Initialize populatedTemplates as an empty array
            var populatedTemplates = [];

            // Check if userInputs is defined and not empty before using Promise.all()
            if (userInputs && userInputs.length > 0) {
                // Wait for all promises to resolve and process the results
                populatedTemplates = await Promise.all(userInputs);
            }

            populatedTemplates.forEach(function (template) {
                if (template && template.inputs) {
                    Object.keys(template.inputs).forEach(function (inputName) {
                        var inputValue = template.inputs[inputName].value;

                        console.log('Merging input:', inputName, 'with value:', inputValue);

                        // Check if the input exists in the parsedConstantTemplate
                        if (mergedTemplate.topology_template.inputs && mergedTemplate.topology_template.inputs.hasOwnProperty(inputName)) {
                            // Update the default value of the existing input
                            mergedTemplate.topology_template.inputs[inputName].default = inputValue;
                        } else {
                            // If the input doesn't exist, add it dynamically
                            mergedTemplate.topology_template.inputs[inputName] = {
                                type: 'string',
                                description: inputName,
                                default: inputValue
                            };
                        }
                    });
                }

                // Merge nodeTemplates
                if (template && template.nodeTemplates) {
                    template.nodeTemplates.forEach(function (nodeTemplatesObj) {
                        if (nodeTemplatesObj) {
                            Object.keys(nodeTemplatesObj).forEach(function (nodeTemplateName) {
                                if (mergedTemplate.topology_template.node_templates) {
                                    mergedTemplate.topology_template.node_templates[nodeTemplateName] = nodeTemplatesObj[nodeTemplateName];
                                }
                            });
                        }
                    });
                }

                // Merge outputs
                if (template && template.outputs) {
                    Object.values(template.outputs).forEach(function (output) {
                        if (output) {
                            Object.keys(output).forEach(function (outputName) {
                                if (mergedTemplate.topology_template.outputs) {
                                    mergedTemplate.topology_template.outputs[outputName] = output[outputName];
                                }
                            });
                        }
                    });
                }
            });

            return mergedTemplate;
        } catch (error) {
            console.error("Error merging TOSCA recipes:", error);
            return JSON.parse(JSON.stringify(parsedConstantTemplate)); // Return a copy of the parsedConstantTemplate
        }
    };

    async function computeHash(input) {
        const msgUint8 = new TextEncoder().encode(input);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return hashHex;
    };

    var infrastructureState = function (infrastructure) {
        var infrastructureID = infrastructure.infrastructureID;
        var id = infrastructure.providerId;
        var deploymentType = infrastructure.type;
        var host = infrastructure.host;
        var user = infrastructure.user;
        var pass = infrastructure.pass;
        var tenant = infrastructure.tenant;
        // var domain = infrastructure.domain;
        // var authVersion = infrastructure.auth_version;
        // var api_version = infrastructure.api_version; // Not needed

        var pipeAuth = "auth-pipe";
        var cmd = "%%bash \n";
        cmd += "PWD=`pwd` \n";
        // Remove pipes if exist
        cmd += "rm $PWD/" + pipeAuth + " &> /dev/null \n";
        // Create pipes
        cmd += "mkfifo $PWD/" + pipeAuth + "\n";
        // Command to create the infrastructure manager client credentials
        cmd += "echo -e \"id = im; type = InfrastructureManager; username = user; password = pass;\n";

        // Additional credentials based on deploymentType
        if (deploymentType === "OpenStack") {
            cmd += "id = " + id + "; type = " + deploymentType + "; host = " + host + "; username = " + user + "; password = " + pass + "; tenant = " + tenant + ";\" > $PWD/" + pipeAuth + " & \n";
        } else if (deploymentType === "OpenNebula") {
            cmd += "id = " + id + "; type = " + deploymentType + "; host = " + host + "; username = " + user + "; password = " + pass + ";\" > $PWD/" + pipeAuth + " & \n";
        } else if (deploymentType === "AWS") {
            cmd += "id = " + id + "; type = " + deploymentType + "; host = " + host + "; username = " + user + "; password = " + pass + ";\" > $PWD/" + pipeAuth + " & \n";
        }
        cmd += "stateOut=\"`python3 /usr/local/bin/im_client.py getstate " + infrastructureID + " -r https://im.egi.eu/im -a $PWD/" + pipeAuth + "`\" \n";

        cmd += "if [ $? -ne 0 ]; then \n";
        cmd += "    >&2 echo -e $stateOut \n";
        cmd += "    exit 1\n";
        cmd += "else\n";
        cmd += "    echo -e $stateOut \n";
        cmd += "fi\n";
        cmd += "rm $PWD/" + pipeAuth + " &> /dev/null \n";

        console.log('cmd', cmd);
        return cmd;
    };

    var infrastructureIP = function (infrastructureID) {
        var pipeAuth = "auth-pipe";
        var cmd = "%%bash \n";
        cmd += "PWD=`pwd` \n";
        // Remove pipes if exist
        cmd += "rm $PWD/" + pipeAuth + " &> /dev/null \n";
        // Create pipes
        cmd += "mkfifo $PWD/" + pipeAuth + "\n";
        // Command to create the infrastructure manager client credentials
        cmd += "echo -e \"id = im; type = InfrastructureManager; username = user; password = pass;\" > $PWD/" + pipeAuth + " & \n";

        cmd += "ipOut=\"`python3 /usr/local/bin/im_client.py getvminfo " + infrastructureID + " 0 net_interface.1.ip -r https://im.egi.eu/im -a $PWD/" + pipeAuth + "`\" \n";

        cmd += "if [ $? -ne 0 ]; then \n";
        cmd += "    >&2 echo -e $ipOut \n";
        cmd += "    exit 1\n";
        cmd += "else\n";
        cmd += "    echo -e $ipOut \n";
        cmd += "fi\n";
        cmd += "rm $PWD/" + pipeAuth + " &> /dev/null \n";

        console.log('cmdIP', cmd);
        return cmd;
    };

    var checkStream = function (data) {
        if (data.msg_type == "stream") {
            if (data.content.name == "stdout") {
                //Is a stdout message
                return 0;
            } else {
                //Is a error message
                return 1;
            }
        }
        //Is not a stream message
        return -1;
    };

    //*******************//
    //* Jupyter handler *//
    //*******************//        

    var loadJupyterExtension = function () {
        console.log("Initialize APRICOT plugin");
        loadCSS();
        listDeploymentsButton();
        deployMenuButton();
        createListDeploymentsDialog(false);
        createDeployDialog();
    };

    return {
        load_ipython_extension: loadJupyterExtension
    };
});
