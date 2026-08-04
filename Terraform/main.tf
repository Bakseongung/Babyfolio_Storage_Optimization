terraform {
  required_version = ">= 1.0.0"
}

# 172.16.8.145(Terraform 노드)에서 다른 노드들(140~144) 통신 상태 헬스체크
resource "null_resource" "cluster_health_check" {
  provisioner "local-exec" {
    command = <<EOT
      echo "=== [172.16.8.145] K8s 클러스터 대역 네트워크 진단 ==="
      ping -c 1 172.16.8.140 && echo "✅ Master (140) OK"
      ping -c 1 172.16.8.141 && echo "✅ Worker1 (141) OK"
      ping -c 1 172.16.8.142 && echo "✅ Worker2 (142) OK"
      ping -c 1 172.16.8.143 && echo "✅ Worker3 (143) OK"
      ping -c 1 172.16.8.144 && echo "✅ Core (144) OK"
EOT
  }
}
