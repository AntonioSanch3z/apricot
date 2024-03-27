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

    var prefix = "infrastructure-deployment";
    var applications = [];
    var templatesURL = "";
    var deployInfo = {};
    var deploying = false; //Stores if the notebook is deploying something

    var clearDeployInfo = function () {
        var apps = [];
        if (typeof deployInfo.apps != undefined) {
            apps = deployInfo.apps;
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
            "infName": "cluster-name",
            "worker": {
                "num_instances": 1,
                "num_cpus": 1,
                "mem_size": "2 GB",
                "disk_size": "20 GB",
                "num_gpus": 1,
                "image": "",
            },
            "apps": apps,
        }
    }

    var load_css = function () {
        console.log("Loading css");
        var link = document.createElement("link");
        link.type = "text/css";
        link.rel = "stylesheet";
        link.href = requirejs.toUrl("./main.css");
        document.getElementsByTagName("head")[0].appendChild(link);
    }

    var createTable = function (obj) {
        var keyNames = Object.keys(obj);
        var nkeys = keyNames.length;
        var nElements = 0;
        var table = $('<table width="100%" border="5%">');
        var row = $("<tr>");

        //Iterate for all object properties and create first row with its names.
        for (let i = 0; i < nkeys; i++) {
            var name = keyNames[i];
            var column = $("<th>").append(name)

            //Append column to row
            row.append(column);
            //Check if this property has more elements than previous ones
            if (nElements < obj[name].length) {
                nElements = obj[name].length;
            }
        }
        //Apend row to table
        table.append(row);

        //Iterate for properties elements to create all element rows
        for (let j = 0; j < nElements; j++) {
            var row = $("<tr>");
            for (let i = 0; i < nkeys; i++) {
                var name = keyNames[i];

                var column = $("<th>").append(obj[name][j])

                //Append column to row
                row.append(column);
            }
            //Append row to table
            table.append(row)
        }
        return table;
    }

    //****************//
    //*   Buttons    *//
    //****************//

    var listDeployments_button = function () {
        console.log("Creating deployments list button");
        if (!Jupyter.toolbar) {
            events.on("app_initialized.NotebookApp", listDeployments_button);
            return;
        }
        if ($("#listDeployments_button").length === 0) {
            Jupyter.toolbar.add_buttons_group([
                Jupyter.actions.register({
                    "help": "Deployments list",
                    "icon": "fa-list",
                    "handler": toggle_DeploymentList,
                }, "toggle-deployment-list", prefix)
            ]);
        }
    };

    var deploy_button = function () {
        console.log("Creating deploy button");
        if (!Jupyter.toolbar) {
            events.on("app_initialized.NotebookApp", deploy_button);
            return;
        }
        clearDeployInfo();
        if ($("#deploy_button").length === 0) {
            Jupyter.toolbar.add_buttons_group([
                Jupyter.actions.register({
                    "help": "Infrastructure deploy",
                    "icon": "fal fa-sitemap",
                    "handler": toggle_Deploy,
                }, "toggle-deploy", prefix)
            ]);
        }
    };

    //****************//
    //*   Dialogs    *//
    //****************//

    var create_ListDeployments_dialog = function (show) {

        //If kernel is not available, call the function again when it is available
        if (typeof Jupyter.notebook.kernel == "undefined" || Jupyter.notebook.kernel == null) {
            events.on("kernel_ready.Kernel", function (evt, data) {
                create_ListDeployments_dialog(show);
            });
            return;
        }
        console.log("Creating deployments list window");

        // Get cluster list 
        var callbacks = {
            iopub: {
                output: function (data) {
                    //Check message
                    var check = checkStream(data)
                    if (check < 0) return; //Not a stream
                    if (check > 0) { //Error message
                        alert(data.content.text);
                        return;
                    }

                    //Successfully execution
                    console.log("Reviced:")
                    console.log(data.content.text)

                    //Parse data
                    var words = data.content.text.split(" ");
                    console.log("words", words)
                    var lists = {};
                    lists["Name"] = [];
                    lists["State"] = [];
                    lists["IP"] = [];
                    lists["Nodes"] = [];

                    for (let i = 5; i < words.length; i += 4) {
                        lists.Name.push(words[i]);
                        lists.State.push(words[i + 1]);
                        lists.IP.push(words[i + 2]);
                        lists.Nodes.push(words[i + 3]);
                    }

                    var table = createTable(lists);

                    //Check if dialog has been already created
                    if ($("#dialog-deployments-list").length == 0) {
                        var listDeployment_dialog = $('<div id="dialog-deployments-list" title="Deployments list">')
                            .append(table)
                        $("body").append(listDeployment_dialog);
                        $("#dialog-deployments-list").dialog();
                    } else {
                        //Clear dialog
                        $("#dialog-deployments-list").empty();

                        //Append dable
                        $("#dialog-deployments-list").append(table)
                        $("#dialog-deployments-list").dialog("open");
                    }
                    if (show == false) {
                        $("#dialog-deployments-list").dialog("close");
                    }
                }
            }
        };
        var cmd = listClusters();

        console.log(cmd);
        // Deploy using IM
        var Kernel = Jupyter.notebook.kernel;
        Kernel.execute(cmd, callbacks);
        return cmd;
    }

    var create_Deploy_dialog = function () {
        console.log("Creating deploy window");

        var deploy_dialog = $('<div id="dialog-deploy" title="Deploy infrastructure">')

        $("body").append(deploy_dialog);
        $("#dialog-deploy").dialog()

        state_deploy_provider();

        //Close dialog
        $("#dialog-deploy").dialog("close");
    }

    //****************//
    //*  Deployment  *//
    //****************// 

    // select provider function
    var state_deploy_provider = function () {

        //Get dialog
        var deployDialog = $("#dialog-deploy");

        //Clear instance type
        deployInfo.worker.instance = "";

        //Clear dialog
        deployDialog.empty();

        //Informative text
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
                        state_recipe_type();
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

                        state_recipe_type();
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

                        state_recipe_type();
                    }
                }
            ]);
    }

    // Deploy recipe type
    var state_recipe_type = function () {

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
                click: state_deploy_provider
            },
            "Simple-node-disk": function () {
                deployInfo.recipe = "Simple-node-disk";
                applications = ["galaxy", "ansible_tasks", "noderedvm", "minio_compose"];
                state_recipe_features();
            },
            "Slurm": function () {
                deployInfo.recipe = "Slurm";
                applications = ["slurm_cluster", "slurm_elastic", "slurm_galaxy", "docker_cluster"];
                state_recipe_features();
            },
            "Kubernetes": function () {
                deployInfo.recipe = "Kubernetes";
                applications = ["kubernetes", "kubeapps", "prometheus", "minio_compose", "noderedvm", "influxdb", "argo"];
                state_recipe_features();
            }
        });

    }

    var state_recipe_features = function () {

        // Get dialog
        var deployDialog = $("#dialog-deploy");

        // Enable shortcuts
        Jupyter.keyboard_manager.enable();

        // Clear dialog
        deployDialog.empty();

        deployDialog.append($("<p>Select recipe optional features.</p><br>"));

        // Create check boxes with optional app
        var ul = $('<ul class="checkbox-grid">');
        for (let i = 0; i < applications.length; i++) {

            // Load YAML file
            $.get('templates/' + applications[i].toLowerCase() + '.yaml', function (data) {
                // Parse YAML content
                var yamlContent = jsyaml.load(data);
                var metadata = yamlContent.metadata;
                var templateName = metadata.template_name;

                // Create line
                let line = $('<li></li>');
                // Create checkbox
                let checkbox = $('<input type="checkbox" id="' + applications[i] + '-appCheckID" name="' + applications[i] + '" value="' + templateName + '">');
                // Create label
                let label = $('<label for="' + applications[i] + '"></label>');
                label.text(" " + templateName);

                // Check if recipe is Slurm or Kubernetes
                if (deployInfo.recipe === "Slurm" && applications[i] === "slurm_cluster" ||
                    deployInfo.recipe === "Kubernetes" && applications[i] === "kubernetes") {
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
            "Back": state_recipe_type,
            "Next": function () {
                // Set applications
                var selectedApplications = [];
                for (var i = 0; i < applications.length; i++) {
                    var appId = applications[i] + "-appCheckID";
                    if ($("#" + appId).is(":checked")) {
                        selectedApplications.push(applications[i]);
                    }
                }
                deployInfo.apps = selectedApplications;

                state_deploy_credentials();
            }
        });
    }

    // introduce credentials function
    var state_deploy_credentials = function () {

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
                state_recipe_features();
            },
            "Next": function () {
                deployInfo.host = $('#hostIn').val();
                deployInfo.tenant = $('#tenantIn').val();
                deployInfo.user = $("#userIn").val();
                deployInfo.credential = $("#userPassIn").val();

                if (deployInfo.deploymentType == "EC2") {
                    state_deploy_EC2_instances();
                }
                else { state_deploy_vmSpec(); }
            }
        });
    }

    // state deploy-EC2-instances
    var state_deploy_EC2_instances = function () {

        //Get dialog
        var deployDialog = $("#dialog-deploy");

        //Clear dialog
        deployDialog.empty();

        //Disable shortcuts
        Jupyter.keyboard_manager.disable();

        //Informative text
        deployDialog.append($("<p>Introduce required EC2 instance types.</p><br>"));

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
            form.append($('<input id="clusterPort" type="number" value="1" min="1"><br>'));
        }

        //Append elements to dialog
        deployDialog.append(form);

        deployDialog.dialog("option", "buttons", {
            "Back": state_deploy_credentials,
            "Next": function () {
                //Availability zone
                var AWSzone = $("#availabilityZoneIn").val();
                var AMI = $("#amiIn").val();
                var imageURL = "aws://" + AWSzone + "/" + AMI;

                deployInfo.worker.image = imageURL;
                deployInfo.port = $("#clusterPort").val();

                state_deploy_vmSpec();
            }
        });
    }

    // state deploy-one-worker
    var state_deploy_vmSpec = function () {

        //Get dialog
        var deployDialog = $("#dialog-deploy");

        //Clear dialog
        deployDialog.empty();

        //Disable shortcuts
        Jupyter.keyboard_manager.disable();

        //Create form for worker node
        var form = $("<form>")
        form.append($("<p>Introduce worker VM specifications.</p><br>"));

        form.append("Cluster name:<br>");
        form.append($('<input id="clusterName" type="text" value="' + deployInfo.infName + '"><br>'));

        form.append("Number of VMs:<br>");
        form.append($('<input id="clusterWorkers" type="number" value="1" min="1"><br>'));

        form.append("Number of CPUs for each VM:<br>");
        form.append($('<input id="clusterCPUs" type="number" value="1" min="1"><br>'));

        form.append("Memory for each VM:<br>");
        form.append($('<input id="clusterMemory" type="text" value="2 GB" min="2""><br>'));

        form.append("Size of the root disk of the VM(s):<br>");
        form.append($('<input id="clusterDiskSize" type="text" value="20 GB" min="20"><br>'));

        form.append("Number of GPUs for each VM:<br>");
        form.append($('<input id="clusterGPUs" type="number" value="1" min="1"><br>'));

        deployDialog.append(form);

        deployDialog.dialog("option", "buttons", {
            "Back": function () {
                state_deploy_credentials();
            },
            "Next": {
                text: deployInfo.apps.length === 0 ? "Deploy" : "Next",
                click: function () {
                    deployInfo.infName = $("#clusterName").val();
                    deployInfo.worker.num_instances = $("#clusterWorkers").val();
                    deployInfo.worker.num_cpus = $("#clusterCPUs").val();
                    deployInfo.worker.mem_size = $("#clusterMemory").val();
                    deployInfo.worker.disk_size = $("#clusterDiskSize").val();
                    deployInfo.worker.num_gpus = $("#clusterGPUs").val();

                    if (deployInfo.apps.length === 0) {
                        state_deploy_app();
                    } else {
                        state_deploy_features();
                    }
                }
            }
        });
    }

    var state_deploy_features = function () {
        // Get dialog
        var deployDialog = $("#dialog-deploy");

        // Clear dialog
        deployDialog.empty();

        // Disable shortcuts
        Jupyter.keyboard_manager.disable();

        var apps = deployInfo.apps;

        // Container for buttons
        var buttonsContainer = $('<div id="buttons-container"></div>');
        deployDialog.append(buttonsContainer); // Moved the buttonsContainer creation to be added to the dialog

        // Dynamically create forms based on YAML templates
        async function createForm(app, index) {
            var form = $('<form id="form-' + app.toLowerCase() + '">');
            var response = await $.get('templates/' + app.toLowerCase() + '.yaml');
            var data = jsyaml.load(response);
            var metadata = data.metadata;
            var templateName = metadata.template_name; // Get the template name
            var inputs = data.topology_template.inputs;

            form.append("<p>Specifications for the " + templateName + " application.</p>");

            // Create button with the template name
            var appButton = $('<button class="formButton">' + templateName + '</button>');

            appButton.click(function () {
                var appName = $(this).text().toLowerCase();
                deployDialog.find('form').hide(); // Hide all forms
                form.show(); // Show the form for the selected app
            });

            // Append button to buttons container
            buttonsContainer.append(appButton);

            // Extract fields from YAML content
            if (inputs) {
                Object.keys(inputs).forEach(function (key) {
                    var description = inputs[key].description;
                    var defaultValue = inputs[key].default || '';
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

            // Append form to dialog
            deployDialog.append(form);

            // Show the form for the first app by default
            if (index !== 0) {
                form.hide();
            }

            var nodeTemplates = data.topology_template.node_templates;
            var outputs = data.topology_template.outputs;

            return {
                form,
                nodeTemplates,
                outputs
            }; // Return the form, node templates, and outputs for later use
        }

        Promise.all(apps.map(createForm)).then((forms, nodeTemplates, outputs) => {
            var nodeTemplates = forms.map(form => form.nodeTemplates);
            var outputs = forms.map(form => form.outputs);
            deployDialog.dialog("option", "buttons", {
                "Back": function () {
                    state_deploy_vmSpec();
                },
                "Deploy": function () {
                    var userInputs = forms.map(async function (formData) {
                        var form = formData.form;
                        var appName = form.attr('id').replace('form-', '');
                        var recipeContent = await $.get('templates/' + appName + '.yaml');
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

                        return {
                            name: appName,
                            inputs: inputsWithValues,
                            nodeTemplates: nodeTemplates,
                            outputs: outputs
                        };
                    });
                    state_deploy_app(userInputs, nodeTemplates, outputs);
                }
            });
        });

    };

    var state_deploy_app = function (populatedTemplates, nodeTemplates, outputs) {
        var deployDialog = $("#dialog-deploy");

        // Clear dialog
        deployDialog.empty();

        // Disable shortcuts
        Jupyter.keyboard_manager.disable();

        // Deployment logic
        if (deploying) {
            alert("Previous deploy has not finished.");
            return; // Deploy only one infrastructure at once
        }
        deploying = true;

        // Load using AJAX and parse the content of simple-node-disk.yaml
        $.get('templates/simple-node-disk.yaml', async function (content) {
            try {
                var parsedConstantTemplate = jsyaml.load(content);

                // Add infra_name and a hash to metadata field
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
                    var deployCmd = deployIMCommand(deployInfo, templatesURL, yamlContent);

                    // Clear dialog
                    deployDialog.empty();

                    // Show loading spinner
                    deployDialog.append($('<div class="loader"></div>'));

                    // Remove buttons
                    deployDialog.dialog("option", "buttons", {});

                    // Create kernel callback
                    var deployCallbacks = {
                        iopub: {
                            output: function (data) {
                                // Check if the content contains an error
                                if (data.content.text.includes("ERROR")) {
                                    // Execute the error handling code if "ERROR" is found
                                    deploying = false;
                                    alert(data.content.text);
                                    console.log(data.content.text);
                                    if (deployInfo.apps.length === 0) {
                                        state_deploy_vmSpec();
                                    } else state_deploy_features();
                                } else {
                                    var pubtext = data.content.text.replace("\r", "\n");
                                    deploying = false;
                                    alert(pubtext);
                                    console.log(pubtext);

                                    // Extract ID using regular expression
                                    var idMatch = pubtext.match(/ID: ([\w-]+)/);
                                    var randomId = idMatch[1];

                                    // Create a JSON object
                                    var jsonObj = {
                                        randomId: randomId
                                    };

                                    var saveCmd = saveToClusterList(jsonObj);
                                    Kernel.execute(saveCmd);

                                    create_Deploy_dialog();
                                }
                            }
                        }
                    };

                    // Deploy using IM
                    var Kernel = Jupyter.notebook.kernel;
                    Kernel.execute(deployCmd, deployCallbacks);

                });
            } catch (error) {
                console.error("Error parsing simple-node-disk.yaml:", error);
            }
        });
    };

    var deployIMCommand = function (obj, templateURL, mergedTemplate) {
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
        // Command to create the infrastructure manager client credentials
        if (obj.deploymentType == "OpenStack") {
            cmd += "echo -e \"id = im; type = InfrastructureManager; username = user; password = pass \n" +
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
        // Print im output on stderr or stdout
        cmd += "if [ $? -ne 0 ]; then \n";
        cmd += "    >&2 echo -e $imOut \n";
        cmd += "    exit 1\n";
        cmd += "else\n";
        cmd += "    echo -e $imOut \n";
        cmd += "fi\n";

        console.log("cmd", cmd);
        return cmd;
    };

    var saveToClusterList = function (obj) {
        var filePath = "$PWD/apricot_plugin/clusterList.json";
        //var filePath = "C:/Users/Antonio/Documents/projects/apricot/apricot_plugin/clusterList.json";
        var cmd = "%%bash \n";
        cmd += "echo '" + JSON.stringify(obj) + "' >> " + filePath + "\n";
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
    }

    async function computeHash(input) {
        const msgUint8 = new TextEncoder().encode(input);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return hashHex;
    }

    // Function to execute clusterState for each ID and update clusters dictionary
    var updateClustersState = function () {
        //var pipeAuth = deployInfo.infName + "-auth-pipe";
        var Kernel = Jupyter.notebook.kernel;
        for (var id in clusters) {
            if (clusters.hasOwnProperty(id)) {
                //var infrastructureId = clusters[id].id;
                var clusterStateCmd = clusterState();
                //var clusterStateCmd = `python3 /usr/local/bin/im_client.py getstate ${infrastructureId} -a $PWD/${pipeAuth} -r https://im.egi.eu/im`;
                var clusterStateCallback = {
                    iopub: {
                        output: function (data) {
                            console.log("data", data);
                            var text = data.content.text;
                            console.log("text", text);
                            if (text.includes("state:")) {
                                var state = text.split("state:")[1].trim();
                                clusters[id].state = state;
                                console.log("Updated state for " + id + ": " + state);
                            }
                        }
                    }
                };
                Kernel.execute(clusterStateCmd, clusterStateCallback);
            }
        }
    };

    // var listClusters = function () {
    //     var pipeAuth = deployInfo.infName + "-auth-pipe";
    //     var cmd = "%%bash \n";
    //     cmd += "echo -e \"id = im; type = InfrastructureManager; username = user; password = pass \n\" > $PWD/" + pipeAuth + " & \n";
    //     cmd += "imOut=\"`python3 /usr/local/bin/im_client.py -a $PWD/" + pipeAuth + " -r https://im.egi.eu/im list `\" \n";
    //     //filter infra_name 'jupyter_.*'  filter 'metadata: \.infra_name: jupyter_[a-zA-Z0-9_]*'

    //     // Print IM output on stderr or stdout
    //     cmd += "if [ $? -ne 0 ]; then \n";
    //     cmd += "    >&2 echo -e $imOut \n";
    //     cmd += "    exit 1\n";
    //     cmd += "else\n";
    //     cmd += "    echo -e $imOut \n";
    //     cmd += "fi\n";
    //     return cmd;
    // }

    var clusterState = function (infID) {
        var pipeAuth = "auth-pipe";
        var cmd = "%%bash \n";
        cmd += "PWD=`pwd` \n";
        // Remove pipes if exist
        cmd += "rm $PWD/" + pipeAuth + " &> /dev/null \n";
        // Create pipes
        cmd += "mkfifo $PWD/" + pipeAuth + "\n";
        // Command to create the infrastructure manager client credentials
        cmd += "echo -e \"id = im; type = InfrastructureManager; username = user; password = pass;\n\" > $PWD/" + pipeAuth + " & \n";

        cmd += "stateOut=\"`python3 /usr/local/bin/im_client.py getstate " + infID + " -r https://im.egi.eu/im -a $PWD/" + pipeAuth + "`\" \n";

        cmd += "if [ $? -ne 0 ]; then \n";
        cmd += "    >&2 echo -e $stateOut \n";
        cmd += "    exit 1\n";
        cmd += "else\n";
        cmd += "    echo -e $stateOut \n";
        cmd += "fi\n";

        console.log("clusters", clusters);

        // for (var id in clusters) {
        //     if (clusters.hasOwnProperty(id)) {
        //         var cluster = clusters[id];
        //         var infrastructureId = cluster.id;

        //         cmd += "stateOut=$(python3 /usr/local/bin/im_client.py getstate " + infrastructureId + " -a $PWD/" + pipeAuth + ") \n";

        //         cmd += "if [ $? -ne 0 ]; then \n";
        //         cmd += "    >&2 echo -e $stateOut \n";
        //         cmd += "    exit 1\n";
        //         cmd += "else\n";
        //         cmd += "    echo -e $stateOut \n";
        //         cmd += "fi\n";

        //         // Store the output of the bash script in cluster.state
        //         cmd += "echo $stateOut\n";
        //         cmd += "clusters['" + id + "'].state=$stateOut\n"; // Access clusters directly
        //     }
        // }

        // Remove pipe
        cmd += "rm $PWD/" + pipeAuth + " &> /dev/null \n";
        console.log("clusters", clusters)
        return cmd;
    };

    var listClusters = function () {
        var pipeAuth = deployInfo.infName + "-auth-pipe";
        var cmd = "%%bash \n";
        cmd += "echo -e \"id = im; type = InfrastructureManager; username = user; password = pass \n" +
            "id = " + deployInfo.id + "; type = " + deployInfo.deploymentType + "; host = " + deployInfo.host + "; username = " + deployInfo.user + "; password = " + deployInfo.credential + "; tenant = " + deployInfo.tenant + ";\" > $PWD/" + pipeAuth + " & \n";
        cmd += "imOut=\"`python3 /usr/local/bin/im_client.py -a $PWD/" + pipeAuth + " list -r https://im.egi.eu/im" + " `\" \n";

        // Print IM output on stderr or stdout
        cmd += "if [ $? -ne 0 ]; then \n";
        cmd += "    >&2 echo -e $imOut \n";
        cmd += "    exit 1\n";
        cmd += "else\n";
        cmd += "    echo -e $imOut \n";
        cmd += "fi\n";
    }

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
    }

    //****************//
    //*Dialogs handle*//
    //****************//    

    var toggle_DeploymentList = function () {
        if ($("#dialog-deployments-list").dialog("isOpen")) {
            $("#dialog-deployments-list").dialog("close");
        } else {
            create_ListDeployments_dialog(true);
            $("#dialog-deployments-list").dialog("moveToTop");
        }
        Jupyter.notebook.set_dirty();
    }

    var toggle_Deploy = function () {
        if ($("#dialog-deploy").dialog("isOpen")) {
            $("#dialog-deploy").dialog("close");
        } else {
            $("#dialog-deploy").dialog("open");
            $("#dialog-deploy").dialog("moveToTop");
        }
        Jupyter.notebook.set_dirty();
    }

    //*******************//
    //* Jupyter handler *//
    //*******************//        

    var load_jupyter_extension = function () {
        console.log("Initialize deployment plugin");
        load_css();

        //Get local yml directory
        var url = requirejs.toUrl("./templates");
        templatesURL = location.protocol + '//' + location.host
            + url.substring(0, url.lastIndexOf('/'))
            + "/templates";
        console.log("Templates url: " + templatesURL);

        listDeployments_button();
        deploy_button();
        create_ListDeployments_dialog(false);
        create_Deploy_dialog();
    }

    return {
        load_ipython_extension: load_jupyter_extension
    };
});
