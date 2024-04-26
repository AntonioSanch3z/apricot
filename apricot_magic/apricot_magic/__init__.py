
from __future__ import print_function
from IPython.core.magic import (Magics, magics_class, line_magic,
                                cell_magic, line_cell_magic)
import os, glob
import subprocess
import json
from tabulate import tabulate

@magics_class
class Apricot(Magics):

    actualDir = ""
    oneDataToken = ""
    oneDataHost = ""
    oneDataStore = "/opt/onedata_spaces/"

    ########################
    #  Auxiliar functions  #
    ########################
    
    def split_clear(self, line, pattern=' '):
        if len(line) == 0:
            return []

        return list(filter(len,line.split(pattern)))
    
    def create_auth_pipe(self, infrastructure_id):
        # Read the JSON data from the file
        with open('apricot_plugin/infrastructuresList.json') as f:
            data = json.load(f)

        # Find the infrastructure with the specified ID
        found_infrastructure = None
        for infrastructure in data['infrastructures']:
            if infrastructure['infrastructureID'] == infrastructure_id:
                found_infrastructure = infrastructure
                break

        if found_infrastructure is None:
            raise ValueError(f"Infrastructure with ID {infrastructure_id} does not exist.")

        # Construct auth-pipe content based on infrastructure type
        auth_content = f"type = InfrastructureManager; username = user; password = pass;\n"
        # Additional credentials based on infrastructure type
        if found_infrastructure['type'] == "OpenStack":
            auth_content += f"id = {found_infrastructure['id']}; type = {found_infrastructure['type']}; username = {found_infrastructure['user']}; password = {found_infrastructure['pass']}; host = {found_infrastructure['host']}; tenant = {found_clustfound_infrastructureer['tenant']}"
        elif found_infrastructure['type'] == "OpenNebula":
            auth_content += f"id = {found_infrastructure['id']}; type = {found_infrastructure['type']}; username = {found_infrastructure['user']}; password = {found_infrastructure['pass']}; host = {found_infrastructure['host']}"
        elif found_infrastructure['type'] == "AWS":
            auth_content += f"id = {found_infrastructure['id']}; type = {found_infrastructure['type']}; username = {found_infrastructure['user']}; password = {found_infrastructure['pass']}; host = {found_infrastructure['host']}"

        # Write auth-pipe content to a file
        with open('auth-pipe', 'w') as auth_file:
            auth_file.write(auth_content)

        return

    def generate_key(self, infrastructure_id, vm_id):
        ##########################################
        #   Generates private key and host IP    #
        ##########################################
        private_key_content = None
        host_ip = None

        cmd_getvminfo = [
            'python3',
            '/usr/local/bin/im_client.py',
            'getvminfo',
            infrastructure_id,
            vm_id,
            '-r',
            'https://im.egi.eu/im',
            '-a',
            'auth-pipe',
        ]

        try:
            # Execute command and capture output
            state_output = subprocess.check_output(cmd_getvminfo, universal_newlines=True)
            # Split the output by lines
            state_lines = state_output.split('\n')

            # Iterate over each line in the output to capture key and host IP
            private_key_started = False
            for line in state_lines:
                if line.strip().startswith("disk.0.os.credentials.private_key ="):
                    private_key_started = True
                    private_key_content = line.split(" = ")[1].strip().strip("'") + '\n'
                    continue
                # If private key capture has started, capture lines until END RSA PRIVATE KEY
                if private_key_started:
                    private_key_content += line + '\n'
                # Check if the line contains the end of the private key
                if "END RSA PRIVATE KEY" in line:
                    private_key_started = False

                if line.strip().startswith("net_interface.1.ip ="):
                    # Extract the host IP
                    host_ip = line.split("'")[1].strip()
                    break

            if private_key_content:
                with open("key.pem", "w") as key_file:
                    key_file.write(private_key_content)

                # Change permissions of key.pem to 600
                os.chmod("key.pem", 0o600)

            return private_key_content, host_ip

        except subprocess.CalledProcessError as e:
            # If the subprocess call fails, return the error output
            error_output = e.output
            return None, None

    ##################
    #     Magics     #
    ##################

    @line_magic
    def apricot_log(self, line):
        if len(line) == 0:
            print("Usage: apricot_log infrastructure-id\n")
            return "Fail"

        # Split line
        words = self.split_clear(line)
        # Get cluster ID
        inf_id = words[0]

        try:
            self.create_auth_pipe(inf_id)
        except ValueError as e:
            print(e)
            return "Failed"

        cmd_getcontmsg = [
            "python3",
            "/usr/local/bin/im_client.py",
            "getcontmsg",
            inf_id,
            "-a",
            "auth-pipe",
            "-r",
            "https://im.egi.eu/im",
        ]

        pipes = subprocess.Popen(cmd_getcontmsg, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        std_out, std_err = pipes.communicate()
        std_out = std_out.decode("utf-8")
        std_err = std_err.decode("utf-8")
                
        if pipes.returncode == 0:
            # Send output to notebook
            print(std_out)

        else:
            # Send error and output to notebook
            print("Status: fail " + str(pipes.returncode) + "\n")
            print(std_err + "\n")
            print(std_out)
            return "Fail"

        if os.path.exists('auth-pipe'):
            os.remove('auth-pipe')

        return

    @line_magic
    def apricot_ls(self, line):
        infrastructures_list = []

        with open('apricot_plugin/infrastructuresList.json') as f:
            data = json.load(f)

        # Iterate through each infrastructure of infrastructuresList.json
        for infrastructure in data['infrastructures']:
            infrastructure_info = {
                'Name': infrastructure['name'],
                'InfrastructureID': infrastructure['infrastructureID'],
                'IP': "",
                'State': ""
            }

            try:
                self.create_auth_pipe(infrastructure['infrastructureID'])
            except ValueError as e:
                print(e)
                return "Failed"

            cmd_getstate = [
                'python3',
                '/usr/local/bin/im_client.py',
                'getstate',
                infrastructure['infrastructureID'],
                '-r',
                'https://im.egi.eu/im',
                '-a',
                'auth-pipe',
            ]

            try:
                # Execute command and capture output
                state_output = subprocess.check_output(cmd_getstate, universal_newlines=True)
                # Process state_output to extract state information
                state_words = state_output.split()
                state_index = state_words.index("state:") if "state:" in state_words else -1

                if state_index != -1 and state_index < len(state_words) - 1:
                    state = state_words[state_index + 1].strip()
                    infrastructure_info['State'] = state
                else:
                    infrastructure_info['State'] = "Error: State not found"

            except subprocess.CalledProcessError as e:
                infrastructure_info['State'] = f"Error: {e.output.strip()}"

            cmd_getvminfo = [
                'python3',
                '/usr/local/bin/im_client.py',
                'getvminfo',
                infrastructure['infrastructureID'],
                '0',
                'net_interface.1.ip',
                '-r',
                'https://im.egi.eu/im',
                '-a',
                'auth-pipe',
            ]

            try:
                # Execute command and capture output
                ip_output = subprocess.check_output(cmd_getvminfo, universal_newlines=True)
                # Process output to extract IP information
                if "error" in ip_output.lower():
                    ip = "Error: " + ip_output.strip()
                else:
                    ip = ip_output.split()[-1].strip()

                infrastructure_info['IP'] = ip
            except subprocess.CalledProcessError as e:
                infrastructure_info['IP'] = f"Error: {e.output.strip()}"

            infrastructures_list.append(infrastructure_info)

        # Convert infrastructures_list to a list of lists for tabulate
        infrastructure_data = [[infrastructure['Name'], infrastructure['InfrastructureID'], infrastructure['IP'], infrastructure['State']] for infrastructure in infrastructures_list]

        # Print the information as a table using tabulate
        print(tabulate(infrastructure_data, headers=['Name', 'Infrastructure ID', 'IP', 'State'], tablefmt='grid'))
        
        if os.path.exists('auth-pipe'):
            os.remove('auth-pipe')

        return

    @line_magic
    def apricot_vmls(self, line):
        if len(line) == 0:
            print("Usage: apricot_vmls infrastructure-id\n")
            return "Fail"

        # Split line
        words = self.split_clear(line)
        # Get infrastructure ID
        inf_id = words[0]

        vm_info_list = []
        current_vm_id, ip_address, status, provider_type, os_image = None, None, None, None, None

        try:
            self.create_auth_pipe(inf_id)
        except ValueError as e:
            print(e)
            return "Failed"

        cmd_getinfo = [
            'python3',
            '/usr/local/bin/im_client.py',
            'getinfo',
            inf_id,
            '-r',
            'https://im.egi.eu/im',
            '-a',
            'auth-pipe',
        ]

        # Execute command and capture output
        state_output = subprocess.check_output(cmd_getinfo, universal_newlines=True)
        # Split the output by lines
        state_lines = state_output.split('\n')

        try:
            for line in state_lines:
                if all((current_vm_id, ip_address, status, provider_type, os_image)):
                    vm_info_list.append([current_vm_id, ip_address, status, provider_type, os_image])
                    current_vm_id, ip_address, status, provider_type, os_image = None, None, None, None, None
                
                else:
                    if line.startswith("Info about VM with ID:"):
                        current_vm_id = line.split(":")[1].strip()
                    if line.strip().startswith("net_interface.1.ip ="):
                        ip_address = line.split("'")[1].strip()
                    if line.strip().startswith("state ="):
                        status = line.split("'")[1].strip()
                    if line.strip().startswith("provider.type ="):
                        provider_type = line.split("'")[1].strip()
                    if line.strip().startswith("disk.0.image.url ="):
                        os_image = line.split("'")[1].strip()

            if all((current_vm_id, ip_address, status, provider_type, os_image)):
                vm_info_list.append([current_vm_id, ip_address, status, provider_type, os_image])

        except subprocess.CalledProcessError as e:
            print(f"Error: {e.output.strip()}")

        # Print the information as a table using tabulate
        print(tabulate(vm_info_list, headers=['VM ID', 'IP Address', 'Status', 'Provider', 'OS Image'], tablefmt='grid'))
        
        if os.path.exists('auth-pipe'):
            os.remove('auth-pipe')
        
        return

    # @line_magic
    # def apricot_onedata(self,line):
    #     if len(line) == 0:
    #         print("usage: apricot_onedata clustername instruction parameters...\n")
    #         print("Valid instructions are: mount, umount, download, upload, set-token, get-token, set-host, get-host")
    #         return "fail"

    #     #Split line
    #     words = self.split_clear(line)
    #     if len(words) < 2:
    #         print("usage: apricot_onedata clustername instruction parameters...\n")
    #         print("Valid instructions are: mount, umount, download, upload, set-token, get-token, set-host, get-host")
    #         return "fail"

    #     #Get cluster name
    #     clusterName = words[0]

    #     #Get instruction
    #     instruction = words[1]

    #     if instruction == "set-token":
    #         if len(words) < 3:
    #             print("No token specified")
    #             return "fail"
    #         oneDataToken = words[3]
    #     elif instruction == "get-token":
    #         return oneDataToken
    #     elif instruction == "set-host":
    #         if len(words) < 3:
    #             print("No host specified")
    #             return "fail"
    #         oneDataHost = words[3]
    #     elif instruction == "get-host":
    #         return oneDataHost
    #     elif instruction == "mount":

    #         if len(words) < 3:
    #             print("No mount point specified")
    #             return "fail"

    #         #Create directory to mount specified space
    #         if words[2][0] == '/':
    #             mountPoint = words[2]                
    #         else:
    #             mountPoint = self.oneDataStore + words[2]

    #         self.apricot("exec " + clusterName + " rm -r " + mountPoint + "&> /dev/null")
    #         status = self.apricot("exec " + clusterName + " mkdir " + mountPoint)
    #         if status != "done":
    #             print("Unable to create directory: " + mountPoint)
    #             return "fail"
                
            
    #         if len(words) < 4:
    #             return self.apricot("exec " + clusterName + " oneclient -H " + oneDataHost + " -t " + oneDataToken + " " + mountPoint)
    #         if len(words) < 5:
    #             return self.apricot("exec " + clusterName + " oneclient -H " + words[3] + " -t " + oneDataToken + " " + mountPoint)
    #         else:
    #             return self.apricot("exec " + clusterName + " oneclient -H " + words[3] + " -t " + words[4] + " " + mountPoint)

    #     elif instruction == "umount":
    #         if len(words) < 3:
    #             print("No mount point specified")
    #             return "fail"
    #         return self.apricot("exec " + clusterName + " oneclient -u " + words[2])

    #     elif instruction == "download" or instruction == "upload":
    #         if len(words) < 4:
    #             print("usage: apricot_onedata clusterName cp onedataPath localPath")
    #             return "fail"

            
    #         if instruction == "download":
    #             origin = self.oneDataStore + words[2]
    #             destin = words[3]
    #         else:
    #             origin = words[2]
    #             destin = self.oneDataStore + words[3]
                
    #         #Try to copy file from/to already mounted space
    #         status = self.apricot("exec " + clusterName + " cp " + origin + " " + destin)

    #         if status != "done":
    #             return "fail"                
    #         else:
    #             return "done"
        
    #     else:
    #         print("Unknown instruction")
    #         return "fail"

    # @line_magic
    # def apricot_runOn(self, line):
    #     if len(line) == 0:
    #         return "fail"
    #     words = self.split_clear(line)
    #     if len(words) < 3:
    #         print("usage: apricot_runOnAll clustername node-list command")
    #         return "fail"
            
    #     #Get cluster name
    #     clusterName = words[0]
    #     nodeList = words[1]
    #     command = ' '.join(words[2:])
    
    #     return self.apricot("exec " + clusterName + " srun -w " + nodeList + " " + command)

    # @line_magic
    # def apricot_MPI(self,line):

        if len(line) == 0:
            print("usage: apricot_MPI clustername node_number tasks_number remote/path/to/execute romete/path/to/executable arguments")
            return "fail"

        #Split line
        words = self.split_clear(line)
        
        if len(words) < 5:
            print("usage: apricot_MPI clustername node_number tasks_number remote/path/to/execute romete/path/to/executable arguments")
            return "fail"
        

        #Get cluster name
        clusterName = words[0]

        #Get number of nodes to use
        nodes2use = int(words[1])
        if nodes2use <= 0:
            print("Invalid node number")
            return "fail"

        #Get number of tasks to execute
        ntasks = int(words[2])
        if ntasks <= 0:
            print("Invalid task number")
            return "fail"
        
        #Get execution path
        execPath = words[3]        
        
        #Get program path
        executablePath = words[4]
        
        #Get arguments
        arguments = ""
        if len(line) > 5:
            for word in words[5:]:
                arguments += word
        
        command = "exec " + clusterName + " cd " + execPath + " && salloc -N " + str(nodes2use) + " mpirun -n " + str(ntasks) + " --mca btl_base_warn_component_unused 0 " + executablePath + " " + arguments
        if self.apricot(command) != "done":
            return "fail"        
        return "done"
   
    @line_magic
    def apricot_upload(self, line):
        if len(line) == 0:
            print("Usage: apricot_upload infrastructure-id vm-id file1 file2 ... fileN remote-destination-path\n")
            return "Fail"
        words = self.split_clear(line)
        if len(words) < 4:
            print("Usage: apricot_upload infrastructure-id vm-id file1 file2 ... fileN remote-destination-path\n")
            return "Fail"

        inf_id = words[0]
        vm_id = words[1]
        destination = words[len(words) - 1]
        files = words[2:-1]

        try:
            self.create_auth_pipe(inf_id)
        except ValueError as e:
            print(e)
            return "Failed"

        # Call createKey function to extract private key content and host IP
        private_key_content, hostIP = self.generate_key(inf_id, vm_id)

        if private_key_content:
            cmd_scp = [
                'scp',
                '-i',
                'key.pem',
            ]
        # Add each file to the scp command
        for file in files:
            cmd_scp.extend([file])
        # Add the destination path to the scp command
        cmd_scp.append(f'root@{hostIP}:{destination}')

        # Execute scp command and capture output
        pipes = subprocess.Popen(cmd_scp, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        std_out, std_err = pipes.communicate()
        std_out = std_out.decode("utf-8")
        std_err = std_err.decode("utf-8")
                
        if pipes.returncode == 0:
            #Send output to notebook
            print(std_out)

        else:
            #Send error and output to notebook
            print(std_err + "\n")

        if os.path.exists('auth-pipe'):
            os.remove('auth-pipe')
        if os.path.exists('key.pem'):
            os.remove('key.pem')

        return "Done"
            
    @line_magic
    def apricot_download(self, line):
        if len(line) == 0:
            print("Usage: apricot_download infrastructure-id vm-id file1 file2 ... fileN local-destination-path\n")
            return "Fail"
        words = self.split_clear(line)
        if len(words) < 4:
            print("Usage: apricot_download infrastructure-id vm-id file1 file2 ... fileN local-destination-path\n")
            return "Fail"

        inf_id = words[0]
        vm_id = words[1]
        destination = words[len(words) - 1]
        files = words[2:-1]

        try:
            self.create_auth_pipe(inf_id)
        except ValueError as e:
            print(e)
            return "Failed"

        # Call createKey function to extract private key content and host IP
        private_key_content, hostIP = self.generate_key(inf_id, vm_id)

        if private_key_content:
            cmd_scp = [
                'scp',
                '-i',
                'key.pem',
            ]
        # Add each file to the scp command
        for file in files:
            cmd_scp.extend(['root@' + hostIP + ':' + file])
        # Add the destination path to the scp command
        cmd_scp.append(destination)

        # Execute scp command
        pipes = subprocess.Popen(cmd_scp, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        std_out, std_err = pipes.communicate()
        std_out = std_out.decode("utf-8")
        std_err = std_err.decode("utf-8")
                
        if pipes.returncode == 0:
            #Send output to notebook
            print(std_out)
        else:
            #Send error and output to notebook
            print(std_err + "\n")

        if os.path.exists('auth-pipe'):
            os.remove('auth-pipe')
        if os.path.exists('key.pem'):
            os.remove('key.pem')

        return "Done"
            
    @line_cell_magic
    def apricot(self, code, cell=None):
        #Check if is a cell call
        if cell != None:
            lines = self.split_clear(cell,'\n')
            for line in lines:
                if len(line) > 0:
                    if self.apricot(line, None) != "Done":
                        print("Execution stopped")
                        return ("Fail on line: '" + line + "'")
            return "Done"

        if len(code) == 0:
            return "Fail"

        words = self.split_clear(code)
        #Get first word
        word1 = words[0]
        #Get user command
        user_cmd = ""
        if len(words) > 1:
            user_cmd = " ".join(words[1:])

        if word1 == "exec" or word1 == "execAsync":
                
            if len(words) < 3:
                print("Incomplete instruction: " + "'" + code + "' \n 'exec' format is: 'exec infrastructure-id vm-id cmd-command'" )
                return "Fail"
            else:
                inf_id = words[1]
                vm_id = words[2]
                cmd_command = words[3:]

                try:
                    self.create_auth_pipe(inf_id)
                except ValueError as e:
                    print(e)
                    return "Failed"

                # Call createKey function to extract private key content and host IP
                private_key_content, host_ip = self.generate_key(inf_id, vm_id)

                if private_key_content:
                    cmd_ssh = [
                        'ssh',
                        '-i',
                        'key.pem',
                        'root@' + host_ip,
                    ] + cmd_command

                    # Execute ssh command
                    pipes = subprocess.Popen(cmd_ssh, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

                    # Capture the output and error of the command
                    ssh_instruct, std_err = pipes.communicate()
                    ssh_instruct = ssh_instruct.decode("utf-8")
                    std_err = std_err.decode("utf-8")

                    if pipes.returncode == 0:
                        split_result = self.split_clear(ssh_instruct, "\n")
                        if split_result:
                            ssh_instruct = split_result[0]
                        else:
                            ssh_instruct = ""

                        split_result = self.split_clear(ssh_instruct)
                        if split_result:
                            ssh_instruct = split_result
                        else:
                            ssh_instruct = []

                        pipes = subprocess.Popen(cmd_ssh, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

                        #Check if the call is asyncronous
                        if word1 == "execAsync":
                            return pipes
                    
                        std_out, std_err = pipes.communicate()
                        std_out = std_out.decode("utf-8")
                        std_err = std_err.decode("utf-8")

                        print(std_out)

                        if os.path.exists('auth-pipe'):
                            os.remove('auth-pipe')
                        if os.path.exists('key.pem'):
                            os.remove('key.pem')

                        return "Done"
                    else:
                        #Send error and output to notebook
                        print("Status: fail " + str(pipes.returncode) + "\n")
                        print(std_err + "\n")

                        if os.path.exists('auth-pipe'):
                            os.remove('auth-pipe')
                        if os.path.exists('key.pem'):
                            os.remove('key.pem')

                        return "Fail"
                else:
                    #Send error to notebook
                    print("\nMissing infrastructure ID or VM ID\n")
                    return "Fail"
                
        elif word1 == "list":
            self.apricot_ls(code)

        elif word1 == "destroy":
            # Check if only one argument is provided (the infrastructure ID)
            if len(words) != 2:
                print("Usage: destroy infrastructure-id")
                return "Fail"
            else:
                inf_id = words[1]

                try:
                    self.create_auth_pipe(inf_id)
                except ValueError as e:
                    print(e)
                    return "Failed"

                cmd_destroy = [
                    'python3',
                    '/usr/local/bin/im_client.py',
                    'destroy',
                    inf_id,
                    '-r',
                    'https://im.egi.eu/im',
                    '-a',
                    'auth-pipe',
                ]

                # Execute command and capture output
                process = subprocess.Popen(cmd_destroy, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                print("Destroying...\nPlease wait, this may take a few seconds.", end='', flush=True)

                log, std_err = process.communicate()
                log = log.decode('utf-8')
                std_err = std_err.decode('utf-8')

                # Clear the message
                print("\r" + " " * len("Destroying...\nPlease wait, this may take a few seconds."), end='', flush=True)

                if log:
                    print(log)
                if std_err:
                    print(std_err)

                # Load infrastructure list from JSON file
                with open('apricot_plugin/infrastructuresList.json', 'r') as f:
                    data = json.load(f)

                # Find and remove the infrastructure with the specified ID
                for infrastructure in data['infrastructures']:
                    if infrastructure['infrastructureID'] == inf_id:
                        data['infrastructures'].remove(infrastructure)
                        break

                # Write the updated infrastructure list back to the JSON file
                with open('apricot_plugin/infrastructuresList.json', 'w') as f:
                    json.dump(data, f, indent=4)

                if os.path.exists('auth-pipe'):
                    os.remove('auth-pipe')

                return "Done"
        
        return

def load_ipython_extension(ipython):
    ipython.register_magics(Apricot)
